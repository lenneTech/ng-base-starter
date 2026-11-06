import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';

import { fillInput, gotoAndWaitForHydration, waitForHydration } from '@lenne.tech/ng-base/testing';

import { ERASE_RESET_LINK_SCRIPT } from '../../src/app/auth/reset-link-memory';

/**
 * Pins both halves of how the reset page keeps its token.
 *
 * The page strips the token from the address bar once it is in hand, because it would otherwise
 * survive in browser history. A reload then found no token and declared a valid link dead, without
 * a single request. So the page remembers the link, and that memory is the risk: on a shared device
 * the next person in the tab must never receive it, or they can set the previous person's password.
 *
 * Half one: a reload of the entry that received the link keeps it usable. Half two: no other
 * arrival gets it back, and every one of them erases it. A message on screen proves nothing about
 * the second part, so `expectLinkGone` looks into storage as well: on an entry without the id, a
 * reload would show the same message whatever storage still holds.
 *
 * Playwright starts Chromium with `--disable-back-forward-cache`, so "Back" here is a full document
 * load, and the return from the cache has its own test with a synthetic `pageshow`. Safari is not
 * covered at all.
 *
 * The auth endpoints are stubbed: what matters is which token the page sends and what it shows.
 * Redeeming a real token is `auth-lifecycle.spec.ts` Step 9.
 */

const PASSWORD = 'NeuesPasswort123!';
/** Every script bundle of the app (Angular emits hashed `*.js` chunks at the root). Aborting them leaves only the server HTML. */
const APP_BUNDLES = '**/*.js';
const NEXT_PERSON = { email: 'naechste-person@test.com', id: 'next-person', name: 'Nächste Person' };

interface ResetStub {
  /** Tokens of every reset request the page sent, in order. */
  sentTokens: string[];
}

/**
 * Answer `POST …/reset-password` with the given Better Auth response.
 *
 * Filtered by method, because the page itself lives at `/auth/reset-password` and its document
 * request must reach the server untouched.
 */
async function stubResetEndpoint(page: Page, response: { body: unknown; status: number }): Promise<ResetStub> {
  const stub: ResetStub = { sentTokens: [] };
  await page.route('**/reset-password', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    stub.sentTokens.push(JSON.parse(route.request().postData() ?? '{}').token);
    await route.fulfill({ body: JSON.stringify(response.body), contentType: 'application/json', status: response.status });
  });
  return stub;
}

async function stubAuthEndpoint(page: Page, pattern: string, body: unknown): Promise<void> {
  await page.route(pattern, (route) => route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', status: 200 }));
}

async function submitNewPassword(page: Page): Promise<void> {
  await fillInput(page, 'input[name$=".password"]', PASSWORD);
  await fillInput(page, 'input[name$=".confirmPassword"]', PASSWORD);
  await page.getByRole('button', { name: 'Passwort speichern' }).click();
}

async function signInAsNextPerson(page: Page): Promise<void> {
  await fillInput(page, 'input[name$=".email"]', NEXT_PERSON.email);
  await fillInput(page, 'input[name$=".password"]', PASSWORD);
  await page.getByRole('button', { exact: true, name: 'Anmelden' }).click();
}

async function reload(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForHydration(page);
}

async function expectFormUsable(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Passwort speichern' })).toBeEnabled();
  await expect(page.getByText('Link nicht mehr gültig')).toHaveCount(0);
}

async function expectLinkDead(page: Page): Promise<void> {
  await expect(page.getByText('Link nicht mehr gültig')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Passwort speichern' })).toBeDisabled();
}

async function expectLinkGone(page: Page, token: string): Promise<void> {
  await expectLinkDead(page);
  expect(await page.evaluate(() => JSON.stringify(window.sessionStorage))).not.toContain(token);
  await reload(page);
  await expectLinkDead(page);
}

/**
 * Moves the clock of this page and of every later one.
 *
 * Not `page.clock`: it fakes `performance` as well, and the Navigation Timing entries the page
 * decides on disappear with it.
 */
async function moveClockForward(page: Page, milliseconds: number): Promise<void> {
  const move = (offset: number): void => {
    const now = Date.now;
    Date.now = () => now() + offset;
  };
  await page.evaluate(move, milliseconds);
  await page.addInitScript(move, milliseconds);
}

/** Pins the precondition of a test, so a changed flow fails instead of passing for the wrong reason. */
async function expectDocumentType(page: Page, type: NavigationTimingType): Promise<void> {
  const actual = await page.evaluate(() => (window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type);
  expect(actual).toBe(type);
}

async function expectNotInHistoryState(page: Page, token: string): Promise<void> {
  expect(await page.evaluate(() => JSON.stringify(window.history.state))).not.toContain(token);
}

test.describe('Reset-password link', () => {
  test.describe('stays usable', () => {
    test('after the page is reloaded, repeatedly', async ({ page }) => {
      const stub = await stubResetEndpoint(page, { body: { status: true }, status: 200 });

      await gotoAndWaitForHydration(page, '/auth/reset-password?token=first-load-token');

      // The token still leaves the address bar: the fix must not undo that hardening.
      await expect(page).toHaveURL(/\/auth\/reset-password$/);
      await expectNotInHistoryState(page, 'first-load-token');

      await reload(page);
      await expectDocumentType(page, 'reload');
      await expectFormUsable(page);
      await expect(page).toHaveURL(/\/auth\/reset-password$/);

      await reload(page);
      await expectFormUsable(page);

      await submitNewPassword(page);
      await expect(page.getByRole('heading', { name: 'Passwort zurückgesetzt' })).toBeVisible();
      expect(stub.sentTokens).toEqual(['first-load-token']);
    });

    test('after the form has been open for a long time', async ({ page }) => {
      const stub = await stubResetEndpoint(page, { body: { status: true }, status: 200 });

      await gotoAndWaitForHydration(page, '/auth/reset-password?token=patient-token');

      // The window counts from leaving the page, not from arriving on it.
      await moveClockForward(page, 600_000);
      await reload(page);
      await expectFormUsable(page);

      await submitNewPassword(page);
      await expect(page.getByRole('heading', { name: 'Passwort zurückgesetzt' })).toBeVisible();
      expect(stub.sentTokens).toEqual(['patient-token']);
    });

    test('after a failure that is not about the link', async ({ page }) => {
      const stub = await stubResetEndpoint(page, { body: { message: 'Too many requests' }, status: 429 });

      await gotoAndWaitForHydration(page, '/auth/reset-password?token=retry-token');
      await submitNewPassword(page);
      await expect(page.getByText('Gerade nicht möglich')).toBeVisible();

      await reload(page);

      // A rate limit or a server hiccup says nothing about the link: a retry must still work.
      await expectFormUsable(page);
      await submitNewPassword(page);
      // Polled: the click returns before validation, hashing and the request have run, and the
      // alert from the first attempt is still on screen, so there is nothing visible to wait for.
      await expect.poll(() => stub.sentTokens).toEqual(['retry-token', 'retry-token']);
    });

    test('for the newest link when a second one is opened in the same tab', async ({ page }) => {
      const stub = await stubResetEndpoint(page, { body: { status: true }, status: 200 });

      await gotoAndWaitForHydration(page, '/auth/reset-password?token=older-token');
      await gotoAndWaitForHydration(page, '/auth/reset-password?token=newer-token');
      await reload(page);

      await submitNewPassword(page);
      await expect(page.getByRole('heading', { name: 'Passwort zurückgesetzt' })).toBeVisible();
      expect(stub.sentTokens).toEqual(['newer-token']);
    });
  });

  test.describe('is forgotten', () => {
    test('once the password has been set', async ({ page }) => {
      await stubResetEndpoint(page, { body: { status: true }, status: 200 });

      await gotoAndWaitForHydration(page, '/auth/reset-password?token=used-token');
      await submitNewPassword(page);
      await expect(page.getByRole('heading', { name: 'Passwort zurückgesetzt' })).toBeVisible();

      await reload(page);

      // A used token is dead; offering the form again would only produce a failure on submit.
      await expectLinkDead(page);
    });

    test('once the server has rejected it', async ({ page }) => {
      await stubResetEndpoint(page, { body: { code: 'INVALID_TOKEN', message: 'Invalid token' }, status: 400 });

      await gotoAndWaitForHydration(page, '/auth/reset-password?token=rejected-token');
      await submitNewPassword(page);
      await expect(page.getByText('Link nicht mehr gültig')).toBeVisible();

      await reload(page);

      await expectLinkDead(page);
    });

    test('when "Neuen Link anfordern" leaves the form', async ({ page }) => {
      await gotoAndWaitForHydration(page, '/auth/reset-password?token=left-token');

      await page.getByRole('link', { name: 'Neuen Link anfordern' }).click();
      await expect(page).toHaveURL(/\/auth\/forgot-password$/);
      // vue-router writes the location it knows into `back` of the entry it creates.
      await expectNotInHistoryState(page, 'left-token');

      await page.goBack();
      // ...and into `current` of the entry it leaves: that once restored the token in the URL.
      await expect(page).toHaveURL(/\/auth\/reset-password$/);
      await expectNotInHistoryState(page, 'left-token');
      await expectLinkGone(page, 'left-token');
    });

    test('when "Neuen Link anfordern" leaves a reloaded form', async ({ page }) => {
      await gotoAndWaitForHydration(page, '/auth/reset-password?token=left-after-reload-token');
      await reload(page);
      await expectFormUsable(page);

      await page.getByRole('link', { name: 'Neuen Link anfordern' }).click();
      await expect(page).toHaveURL(/\/auth\/forgot-password$/);

      // Same document, so the type still says "reload", and the entry still carries its id.
      // Erasing on the way out is the only thing protecting this path.
      await page.goBack();
      await expect(page).toHaveURL(/\/auth\/reset-password$/);
      await expectDocumentType(page, 'reload');
      await expectLinkGone(page, 'left-after-reload-token');
    });

    test('when somebody types the address of the page', async ({ page }) => {
      await gotoAndWaitForHydration(page, '/auth/reset-password?token=abandoned-token');

      await gotoAndWaitForHydration(page, '/auth/reset-password');
      await expectDocumentType(page, 'navigate');

      await expectLinkGone(page, 'abandoned-token');
    });

    test('when Back returns to it after another address was typed', async ({ page }) => {
      await gotoAndWaitForHydration(page, '/auth/reset-password?token=abandoned-token');
      await gotoAndWaitForHydration(page, '/auth/login');

      await page.goBack({ waitUntil: 'domcontentloaded' });
      await waitForHydration(page);
      await expect(page).toHaveURL(/\/auth\/reset-password$/);
      await expectDocumentType(page, 'back_forward');

      await expectLinkGone(page, 'abandoned-token');
    });

    test('when Back returns to it and the head script does not run', async ({ page }) => {
      await gotoAndWaitForHydration(page, '/auth/reset-password?token=abandoned-token');
      await gotoAndWaitForHydration(page, '/auth/login');

      // A project's own CSP can block the script. The check on mount then has to hold alone.
      let scriptRemoved = false;
      await page.route('**/auth/reset-password', async (route) => {
        const response = await route.fetch();
        const html = await response.text();
        scriptRemoved = html.includes(ERASE_RESET_LINK_SCRIPT);
        await route.fulfill({ body: html.replace(ERASE_RESET_LINK_SCRIPT, ''), response });
      });

      await page.goBack({ waitUntil: 'domcontentloaded' });
      await waitForHydration(page);
      expect(scriptRemoved).toBe(true);
      await expectDocumentType(page, 'back_forward');

      await expectLinkGone(page, 'abandoned-token');
    });

    test('when the page returns from the back/forward cache', async ({ page }) => {
      await gotoAndWaitForHydration(page, '/auth/reset-password?token=cached-token');
      await expectFormUsable(page);

      // The page comes back whole, its token still in memory, and no code path of a load runs.
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));

      await expectLinkGone(page, 'cached-token');
    });
  });

  // A reload counts for the whole document, not for one page of the app, so everything that
  // happens in a reloaded document looks like a reload to the Navigation Timing type.
  test.describe('does not reach the next person', () => {
    test('who reloads the login page and is redirected after signing in', async ({ page }) => {
      await stubAuthEndpoint(page, '**/sign-in/email', { user: NEXT_PERSON });

      await gotoAndWaitForHydration(page, '/auth/reset-password?token=abandoned-token');
      await gotoAndWaitForHydration(page, '/auth/login?redirect=/auth/reset-password');
      await reload(page);

      await signInAsNextPerson(page);
      await expect(page).toHaveURL(/\/auth\/reset-password$/);
      await expectDocumentType(page, 'reload');

      await expectLinkGone(page, 'abandoned-token');
    });

    test('who is redirected after the two-factor step', async ({ page }) => {
      await stubAuthEndpoint(page, '**/sign-in/email', { twoFactorRedirect: true });
      await stubAuthEndpoint(page, '**/two-factor/verify-totp', { user: NEXT_PERSON });

      await gotoAndWaitForHydration(page, '/auth/reset-password?token=abandoned-token');
      await gotoAndWaitForHydration(page, '/auth/login?redirect=/auth/reset-password');
      await reload(page);

      await signInAsNextPerson(page);
      await expect(page).toHaveURL(/\/auth\/2fa/);
      await fillInput(page, 'input[autocomplete="one-time-code"]', '123456');
      await page.getByRole('button', { name: 'Verifizieren' }).click();
      await expect(page).toHaveURL(/\/auth\/reset-password$/);
      await expectDocumentType(page, 'reload');

      await expectLinkGone(page, 'abandoned-token');
    });

    test('who goes Back and reloads before the app has hydrated', async ({ page }) => {
      const anotherSite = 'https://another-site.example/';
      await page.route(anotherSite, (route) => route.fulfill({ body: '<h1>Another site</h1>', contentType: 'text/html', status: 200 }));

      await gotoAndWaitForHydration(page, '/auth/reset-password?token=abandoned-token');
      await page.goto(anotherSite);

      // A slow connection taken to the extreme: the document arrives, its bundle does not. No app
      // code runs on this arrival, so only the script in the head can erase the link.
      await page.route(APP_BUNDLES, (route) => route.abort());
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/auth\/reset-password$/);
      await expectDocumentType(page, 'back_forward');

      await page.unroute(APP_BUNDLES);
      await reload(page);
      await expectDocumentType(page, 'reload');

      await expectLinkGone(page, 'abandoned-token');
    });

    test('who goes Back to an error page and reloads once the app answers again', async ({ page }) => {
      const anotherSite = 'https://another-site.example/';
      await page.route(anotherSite, (route) => route.fulfill({ body: '<h1>Another site</h1>', contentType: 'text/html', status: 200 }));

      await gotoAndWaitForHydration(page, '/auth/reset-password?token=abandoned-token');
      await page.goto(anotherSite);

      // A proxy or a maintenance page answers: nothing of ours runs, not even the head script,
      // and the entry keeps its id. Only the time since the page was left stands in the way.
      const maintenancePage = '**/auth/reset-password';
      await page.route(maintenancePage, (route) => route.fulfill({ body: '<h1>Wartung</h1>', contentType: 'text/html', status: 503 }));
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Wartung' })).toBeVisible();

      await moveClockForward(page, 60_000);
      await page.unroute(maintenancePage);
      await reload(page);
      await expectDocumentType(page, 'reload');

      await expectLinkGone(page, 'abandoned-token');
    });

    test('who reloads another site that redirects here', async ({ page }) => {
      await gotoAndWaitForHydration(page, '/auth/reset-password?token=abandoned-token');
      const resetPage = page.url();

      const anotherSite = 'https://another-site.example/';
      let redirects = false;
      await page.route(anotherSite, (route) =>
        redirects ? route.fulfill({ headers: { location: resetPage }, status: 302 }) : route.fulfill({ body: '<h1>Another site</h1>', contentType: 'text/html', status: 200 }),
      );
      await page.goto(anotherSite);

      redirects = true;
      await reload(page);
      await expect(page).toHaveURL(/\/auth\/reset-password$/);
      await expectDocumentType(page, 'reload');

      await expectLinkGone(page, 'abandoned-token');
    });
  });

  test('reports a link without a token as invalid', async ({ page }) => {
    await gotoAndWaitForHydration(page, '/auth/reset-password');

    await expect(page.getByText('ungültig oder fehlt')).toBeVisible();
    await expectLinkDead(page);
  });
});
