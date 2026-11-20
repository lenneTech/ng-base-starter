import type { Browser, Page, Request } from '@playwright/test';

import { expect, test } from '@playwright/test';
import { gotoAndWaitForHydration, waitForHydration } from '@lenne.tech/ng-base/testing';

/**
 * Sign-in through a social provider, in the browser, against a STUBBED API (port of the Nuxt template's
 * `tests/e2e/auth-social-sign-in.spec.ts`).
 *
 * What this spec verifies is what the app sends and how the login page behaves: the buttons for the providers
 * `/iam/features` lists, the body of `POST /iam/sign-in/social`, the page reached with `?error=`, and the silent
 * attempt. None of that needs a provider or a running API, so every API request of the browser is answered here
 * (`stubApi`), as `auth-password-reset.spec.ts` does for its endpoint. The provider round trip itself (Microsoft,
 * Better Auth's callback, the session cookie) needs a configured tenant and is not part of the suite.
 *
 * The silent attempt is opt-in at server start (`NG_PUBLIC_AUTH_SILENT_PROVIDER`), so its tests run only when the app
 * was started with `NG_PUBLIC_AUTH_SILENT_PROVIDER=microsoft` and skip otherwise; the first-paint test of the form
 * runs only without it. The other tests use `github`, which the silent attempt never takes then, so they pass with and
 * without it. Unit-level coverage of the same rules: `src/app/auth/login-page.spec.ts`.
 *
 * Unlike the Nuxt template, the server renders the login page with the feature flags it fetched itself and hands them
 * to the browser. Against a real API without `microsoft` the server therefore renders the form, which is right, and the
 * silent part cannot be stubbed from the browser. Run it with an API the server cannot reach (see `docs/e2e-auth.md`).
 *
 * The first paint is checked with JavaScript off (`firstPaint`): what the server's HTML shows by itself. With the
 * setting it is "Anmeldung wird geprüft …" and the form hidden, so nobody types into a form the attempt takes away;
 * without it, or reached with `?error=`, it is the form.
 *
 * "Never shown" is checked twice: on the rendered page (`body` text) and in the HTML the server sends.
 * `signInErrorTextGuard` answers a login URL with `error_description` with a 302 to the same URL without it, so no
 * document the browser receives carries the text, not even in the router state of the transfer script.
 */

// Same convention as the other e2e specs: never hardcode the port.
const FRONTEND_BASE = process.env.NG_PUBLIC_SITE_URL || process.env.APP_URL || 'http://localhost:3001';
const API_BASE = process.env.NG_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:3000';
const SILENT_PROVIDER = process.env.NG_PUBLIC_AUTH_SILENT_PROVIDER || '';

/** Microsoft's text for a silent attempt without a session, shortened; it must never reach the page. */
const DESCRIPTION = 'AADSTS50058: A silent sign-in request was sent but no user is signed in. Trace ID: 0f1e2d3c Correlation ID: 4b5a6978';

const USER = { email: 'social@test.com', emailVerified: true, id: 'social-user-1', name: 'Social Test', roles: [] };

/**
 * Answers every API request of the browser: `/iam/features` with `providers`, `sign-in/social` with `socialAnswer`,
 * `get-session` with no session (or `USER` with `signedIn`), and everything else with 404. Requests go to the API
 * directly, or through `/api` on the app origin while the dev proxy is on.
 *
 * No session by default: the app validates the session on every start, and a visitor with one is sent on from the
 * login page to the deep link.
 */
async function stubApi(page: Page, providers: string[], socialAnswer: () => { redirect: boolean; url: string }, { signedIn = false } = {}): Promise<Request[]> {
  const socialRequests: Request[] = [];
  const json = (body: unknown, status = 200) => ({ body: JSON.stringify(body), contentType: 'application/json', status });

  for (const pattern of [`${API_BASE}/**`, `${FRONTEND_BASE}/api/**`]) {
    await page.route(pattern, (route) => route.fulfill(json({ message: 'not stubbed' }, 404)));
  }
  await page.route('**/iam/features', (route) =>
    route.fulfill(
      json({ emailVerification: false, enabled: true, jwt: true, passkey: true, signUpChecks: false, signUpEnabled: true, socialProviders: providers, twoFactor: true }),
    ),
  );
  await page.route('**/iam/sign-in/social', (route) => {
    socialRequests.push(route.request());
    return route.fulfill(json(socialAnswer()));
  });
  await page.route('**/iam/get-session', (route) => route.fulfill(json(signedIn ? { session: { id: 'session-1', userId: USER.id }, user: USER } : null)));
  await page.route('**/iam/sign-out', (route) => route.fulfill(json({ success: true })));
  // The provider's authorization page.
  await page.route('https://login.provider.test/**', (route) =>
    route.fulfill({ body: '<!doctype html><title>Provider</title><h1>Provider</h1>', contentType: 'text/html', status: 200 }),
  );

  return socialRequests;
}

/** The redirect answer of Better Auth: off to the provider. */
const toProvider = () => ({ redirect: true, url: 'https://login.provider.test/authorize?client_id=app' });

/** Collects the body of every login document the page receives, to check the served HTML. */
function loginDocuments(page: Page): Promise<string>[] {
  const bodies: Promise<string>[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'document' && response.status() === 200 && new URL(response.url()).pathname === '/auth/login') {
      bodies.push(response.text());
    }
  });
  return bodies;
}

/** The rendered text of the page, without scripts and the transfer state. */
async function pageText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

/** The query of the page's URL, as an object. */
function queryOf(page: Page): Record<string, string> {
  return Object.fromEntries(new URL(page.url()).searchParams);
}

/** The text the login page shows while the silent attempt waits or runs. */
const CHECKING = 'Anmeldung wird geprüft …';

/** Opens `path` with JavaScript off: what the browser shows from the server's HTML alone, before any script runs. */
async function firstPaint(browser: Browser, path: string): Promise<{ close: () => Promise<void>; page: Page }> {
  const context = await browser.newContext({ baseURL: FRONTEND_BASE, ignoreHTTPSErrors: true, javaScriptEnabled: false, locale: 'de' });
  const page = await context.newPage();
  await page.goto(path);
  return { close: () => context.close(), page };
}

/** Collects Angular's hydration warnings (`NG0500`–`NG0507`, "hydration … mismatch") the page logs. */
function hydrationMessages(page: Page): string[] {
  const messages: string[] = [];
  page.on('console', (message) => {
    if (/NG050\d|hydration.*mismatch/i.test(message.text())) {
      messages.push(message.text());
    }
  });
  return messages;
}

/** What the round trip of a silent attempt without provider session ends in: back on the login page. */
const backWithoutSession = () => ({
  redirect: true,
  url: `${FRONTEND_BASE}/auth/login?redirect=%2Fapp&error=login_required&error_description=${encodeURIComponent(DESCRIPTION)}`,
});

test.describe('Sign-in through a social provider', () => {
  test('shows a button per listed provider and sends prompt, callbackURL and errorCallbackURL as designed', async ({ page }) => {
    const socialRequests = await stubApi(page, ['github'], toProvider);
    await gotoAndWaitForHydration(page, '/auth/login?redirect=/app/records/42');

    await page.getByRole('button', { name: 'Mit GitHub anmelden' }).click();
    await page.waitForURL(/login\.provider\.test/);

    expect(socialRequests).toHaveLength(1);
    expect(socialRequests[0]?.method()).toBe('POST');
    expect(socialRequests[0]?.postDataJSON()).toEqual({
      additionalParams: { prompt: 'select_account' },
      callbackURL: `${FRONTEND_BASE}/auth/callback?redirect=%2Fapp%2Frecords%2F42`,
      errorCallbackURL: `${FRONTEND_BASE}/auth/login?redirect=%2Fapp%2Frecords%2F42`,
      provider: 'github',
    });
  });

  test('shows no provider button while the API lists none', async ({ page }) => {
    await stubApi(page, [], toProvider);
    await gotoAndWaitForHydration(page, '/auth/login');

    await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Mit .* anmelden$/ })).toHaveCount(1);
  });

  test('shows the refusal for ?error=access_denied, never the description, and cleans the URL', async ({ page }) => {
    await stubApi(page, ['github'], toProvider);
    const response = await page.goto(`/auth/login?error=access_denied&error_description=${encodeURIComponent(DESCRIPTION)}&redirect=/app/x`);
    await waitForHydration(page);

    // The server answered the URL with the description with a 302 to the same URL without it, and the document it
    // then served does not contain the text anywhere, transfer state included.
    const redirected = response?.request().redirectedFrom();
    expect((await redirected?.response())?.status()).toBe(302);
    expect(new URL(response!.url()).searchParams.has('error_description')).toBe(false);
    expect(new URL(response!.url()).searchParams.get('error')).toBe('access_denied');
    expect(await response!.text()).not.toContain('AADSTS50058');

    await expect(page.getByRole('alert').filter({ hasText: 'Kein Zugang' })).toBeVisible();
    await expect(page.getByText('Dieses Konto ist für diese Anwendung nicht freigeschaltet.', { exact: false })).toBeVisible();
    await expect.poll(() => queryOf(page)).toEqual({ redirect: '/app/x' });
    expect(await pageText(page)).not.toContain('AADSTS50058');

    // A reload must not bring a stale refusal back.
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByRole('button', { name: 'Mit GitHub anmelden' })).toBeVisible();
    await expect(page.getByText('Kein Zugang')).toHaveCount(0);
  });

  test('/auth/callback without a session returns to the login page with its own code and the deep link', async ({ page }) => {
    await stubApi(page, ['github'], toProvider);

    await page.goto('/auth/callback?redirect=/app/records/42');

    await expect(page.getByRole('alert').filter({ hasText: 'Fehlercode: session_missing' })).toBeVisible();
    await expect.poll(() => queryOf(page)).toEqual({ redirect: '/app/records/42' });
    expect(new URL(page.url()).pathname).toBe('/auth/login');
  });
});

test.describe('First paint of the login page without the silent attempt', () => {
  test.skip(SILENT_PROVIDER !== '', 'needs the app started without NG_PUBLIC_AUTH_SILENT_PROVIDER');

  test('the server renders the form', async ({ browser }) => {
    const { close, page } = await firstPaint(browser, '/auth/login');

    await expect(page.getByRole('textbox', { name: /e-mail/i })).toBeVisible();
    await expect(page.getByText(CHECKING)).toHaveCount(0);
    await close();
  });
});

test.describe('Silent sign-in through a social provider', () => {
  test.skip(SILENT_PROVIDER !== 'microsoft', 'needs the app started with NG_PUBLIC_AUTH_SILENT_PROVIDER=microsoft and an API the server cannot reach');

  test('the server renders the checking state, not the form; reached with ?error= the form and the message', async ({ browser, request }) => {
    const html = await (await request.get(`${FRONTEND_BASE}/auth/login`)).text();
    expect(html).toContain(CHECKING);

    const plain = await firstPaint(browser, '/auth/login');
    await expect(plain.page.getByText(CHECKING)).toBeVisible();
    // Hidden with the `hidden` attribute: not visible, not focusable, not in the accessibility tree.
    await expect(plain.page.getByRole('textbox', { name: /e-mail/i })).toBeHidden();
    await expect(plain.page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeHidden();
    await plain.page.keyboard.press('Tab');
    expect(await plain.page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
    await plain.close();

    const refused = await firstPaint(browser, '/auth/login?error=access_denied&redirect=/app/x');
    await expect(refused.page.getByRole('textbox', { name: /e-mail/i })).toBeVisible();
    await expect(refused.page.getByText('Kein Zugang')).toBeVisible();
    await expect(refused.page.getByText(CHECKING)).toHaveCount(0);
    await refused.close();
  });

  test('a marked tab gets the form after hydration, without an attempt and without a mismatch', async ({ page }) => {
    const socialRequests = await stubApi(page, ['microsoft'], toProvider);
    await page.addInitScript(() => window.sessionStorage.setItem('lt-social-sign-in:silent-attempted', '1'));
    const hydration = hydrationMessages(page);

    await gotoAndWaitForHydration(page, '/auth/login');

    await expect(page.getByRole('textbox', { name: /e-mail/i })).toBeVisible();
    await expect(page.getByText(CHECKING)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mit Microsoft anmelden' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(socialRequests).toHaveLength(0);
    expect(hydration).toEqual([]);
  });

  test('the form appears when the API does not list the provider', async ({ page }) => {
    const socialRequests = await stubApi(page, ['github'], toProvider);

    await gotoAndWaitForHydration(page, '/auth/login');

    await expect(page.getByRole('textbox', { name: /e-mail/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mit GitHub anmelden' })).toBeVisible();
    expect(socialRequests).toHaveLength(0);
  });

  test('the form appears at once when /iam/features fails', async ({ page }) => {
    const socialRequests = await stubApi(page, ['microsoft'], toProvider);
    // Registered last, so it answers before the stub above.
    await page.route('**/iam/features', (route) => route.fulfill({ body: '{"message":"down"}', contentType: 'application/json', status: 503 }));

    await gotoAndWaitForHydration(page, '/auth/login');

    // Well inside the page's own timeout (three seconds): the failure itself shows the form.
    await expect(page.getByRole('textbox', { name: /e-mail/i })).toBeVisible({ timeout: 2000 });
    await expect(page.getByText(CHECKING)).toHaveCount(0);
    expect(socialRequests).toHaveLength(0);
  });

  test('runs once per tab: back without provider session, the form stays', async ({ page }) => {
    const socialRequests = await stubApi(page, ['microsoft'], backWithoutSession);
    const documents = loginDocuments(page);

    await page.goto('/auth/login');
    await expect.poll(() => queryOf(page)).toEqual({ redirect: '/app' });
    await expect(page.getByRole('button', { name: 'Mit Microsoft anmelden' })).toBeVisible();

    expect(socialRequests).toHaveLength(1);
    expect(socialRequests[0]?.postDataJSON()).toMatchObject({ additionalParams: { prompt: 'none' }, provider: 'microsoft' });
    // A silent attempt without a session is no error the visitor has to read.
    await expect(page.getByText('Anmeldung fehlgeschlagen')).toHaveCount(0);
    expect(await pageText(page)).not.toContain('AADSTS50058');
    for (const body of await Promise.all(documents)) {
      expect(body).not.toContain('AADSTS50058');
    }

    // Opening the login page again in the same tab starts no second attempt.
    await gotoAndWaitForHydration(page, '/auth/login');
    await expect(page.getByRole('button', { name: 'Mit Microsoft anmelden' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(socialRequests).toHaveLength(1);
  });

  test('does not run after an explicit sign-out, neither in that tab nor in a second one', async ({ context, page }) => {
    const socialRequests = await stubApi(page, ['microsoft'], toProvider, { signedIn: true });
    const appHost = new URL(FRONTEND_BASE);
    await context.addCookies([
      {
        name: 'lt-auth-state',
        secure: appHost.protocol === 'https:',
        url: FRONTEND_BASE,
        value: encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: USER })),
      },
    ]);

    await gotoAndWaitForHydration(page, '/app');
    await page.getByRole('button', { name: 'Abmelden' }).last().click();
    await page.waitForURL(/\/auth\/login/);
    await expect(page.getByRole('button', { name: 'Mit Microsoft anmelden' })).toBeVisible();
    await page.waitForTimeout(500);

    expect(socialRequests).toHaveLength(0);
    await expect(page.getByRole('textbox', { name: /e-mail/i })).toBeVisible();

    // A second tab of the same browser: a fresh sessionStorage, the same localStorage and cookies. While the "signed
    // out" mark was per tab, a tab like this one sent `prompt=none` within seconds and was signed straight back in
    // through the provider session (measured in the Nuxt template).
    const secondTab = await context.newPage();
    const secondTabRequests = await stubApi(secondTab, ['microsoft'], toProvider);
    await gotoAndWaitForHydration(secondTab, '/auth/login');
    await expect(secondTab.getByRole('button', { name: 'Mit Microsoft anmelden' })).toBeVisible();
    await secondTab.waitForTimeout(500);

    expect(secondTabRequests).toHaveLength(0);
    await expect(secondTab.getByRole('textbox', { name: /e-mail/i })).toBeVisible();
    await expect(secondTab.getByText(CHECKING)).toHaveCount(0);
    await secondTab.close();
  });
});
