/**
 * `/auth/verify-email` keeps the e-mail address and the token out of the URL.
 *
 * Login and sign-up used to send visitors there with `?email=…`, and the link in the verification
 * mail carried `?token=…&email=…` until nest-server 12.6.0 (from then on the token alone). In the
 * address bar both went to analytics, into the referrer of links, into the browser history and into
 * every link somebody pasted. The page now takes the address from the history entry and moves both
 * out of the URL the moment it has read them. A reload keeps what the page needs: the address for
 * "send a new e-mail", the outcome of an accepted link, and the token of a refused one.
 *
 * Checked on `history.state` too, not only on `location.href`: vue-router writes the location it
 * knows into `back` and `current`, and a check of the address bar alone misses that.
 *
 * Prerequisites: see `docs/e2e-auth.md`. Skips without e-mail verification on the API.
 */
import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';
import { fillInput, generateTestUser, gotoAndWaitForHydration, waitForURLAndHydration } from '@lenne.tech/ng-base/testing';

import { API_BASE, DEFAULT_FEATURES, FRONTEND_BASE, parseFeatures, resetTestData, waitForVerificationToken, type Features } from './helpers/auth-backend';

let available = false;
let features: Features = { ...DEFAULT_FEATURES };

/** The URL and every location vue-router keeps in the history entry. */
async function locations(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = (window.history.state ?? {}) as Record<string, unknown>;
    return JSON.stringify([window.location.href, state.back, state.current, state.forward]);
  });
}

async function expectNoSecrets(page: Page, ...secrets: string[]): Promise<void> {
  const seen = await locations(page);
  for (const secret of secrets) {
    expect(seen).not.toContain(secret);
    expect(seen).not.toContain(encodeURIComponent(secret));
  }
}

test.beforeAll(async ({ request }) => {
  try {
    available = (await request.get(`${API_BASE}/`)).ok() && (await request.get(`${FRONTEND_BASE}/`)).ok();
    if (available) {
      features = parseFeatures(await (await request.get(`${API_BASE}/iam/features`)).json());
    }
  } catch {
    available = false;
  }
});

test.describe.serial('verify-email keeps the address and the token out of the URL', () => {
  const user = generateTestUser('verify-email-url');

  test.beforeEach(() => {
    test.skip(!available, 'Servers not running');
    test.skip(!features.emailVerification, 'E-mail verification is off on this API');
  });

  test.afterAll(async () => {
    await resetTestData(user.email);
  });

  test('sign-up hands the address over without putting it into the URL', async ({ page }) => {
    await gotoAndWaitForHydration(page, '/auth/register');
    await fillInput(page, 'input[name$=".name"]', user.name);
    await fillInput(page, 'input[name$=".email"]', user.email);
    await fillInput(page, 'input[name$=".password"]', user.password);
    await fillInput(page, 'input[name$=".confirmPassword"]', user.password);
    if (features.signUpChecks) {
      const terms = page.getByRole('checkbox', { name: /akzeptiere die AGB/i });
      await terms.click();
      await expect(terms).toBeChecked();
    }
    await page.getByRole('button', { name: 'Konto erstellen' }).click();
    await waitForURLAndHydration(page, /\/auth\/verify-email/, { timeout: 15000 });

    await expect(page.getByText(user.email)).toBeVisible();
    await expect(page.getByRole('button', { name: /Bestätigungs-E-Mail erneut senden/ })).toBeVisible();
    await expectNoSecrets(page, user.email);

    // The history entry keeps the address across a reload, the URL still does not carry it.
    await page.reload();
    await expect(page.getByText(user.email)).toBeVisible();
    await expectNoSecrets(page, user.email);
  });

  test('the link from the mail loses token and address on arrival, and a reload still confirms', async ({ page }) => {
    const token = await waitForVerificationToken(user.email);
    expect(token, 'Verification token not found in server logs').not.toBeNull();

    // As nest-server builds it: the token alone from 12.6.0 on, which is when the API takes it for a
    // new mail, and with the address before.
    const link = features.resendVerificationByToken ? `/auth/verify-email?token=${token}` : `/auth/verify-email?token=${token}&email=${encodeURIComponent(user.email)}`;
    await gotoAndWaitForHydration(page, link);
    await expect(page.getByRole('heading', { name: 'E-Mail bestätigt' })).toBeVisible({ timeout: 15000 });
    await expectNoSecrets(page, token ?? '', user.email);

    // Before any reload: the first in-app navigation writes `back` from the router's own copy of the
    // location, and Back restores the entry's URL. A raw `history.replaceState` leaves that copy on
    // the old URL, and a reload would rebuild it from the clean address bar and hide the leak.
    await page.getByRole('link', { name: 'Jetzt anmelden' }).click();
    await waitForURLAndHydration(page, /\/auth\/login/);
    await expectNoSecrets(page, token ?? '', user.email);

    await page.goBack();
    await expect(page).toHaveURL(/\/auth\/verify-email$/);
    await expect(page.getByRole('heading', { name: 'E-Mail bestätigt' })).toBeVisible();
    await expectNoSecrets(page, token ?? '', user.email);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'E-Mail bestätigt' })).toBeVisible();
    await expectNoSecrets(page, token ?? '', user.email);

    await page.getByRole('link', { name: 'Jetzt anmelden' }).click();
    await waitForURLAndHydration(page, /\/auth\/login/);
    await expectNoSecrets(page, token ?? '', user.email);
  });

  test('a refused link loses its token on arrival and still leads to a new mail', async ({ page }) => {
    // Shaped like a sealed token (a compact JWE), but nothing the API can open: it refuses the link,
    // and from 12.6.0 on cannot read it for a new mail either. An expired token, the case the resend
    // exists for, cannot be made here; tests/unit/pages/auth-verify-email.test.ts pins the answer
    // with a masked address.
    const refused = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..cmVmdXNlZA.cmVmdXNlZA.cmVmdXNlZA';
    await gotoAndWaitForHydration(page, `/auth/verify-email?token=${refused}`);
    await expect(page.getByRole('heading', { name: 'Verifizierung fehlgeschlagen' })).toBeVisible({ timeout: 15000 });
    await expectNoSecrets(page, refused);

    if (features.resendVerificationByToken) {
      // The token stayed in the history entry, so a reload offers the new mail again.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Verifizierung fehlgeschlagen' })).toBeVisible();
      await expectNoSecrets(page, refused);

      const answer = page.waitForResponse((response) => response.url().includes('/resend-verification-email'));
      await page.getByRole('button', { name: 'Neue E-Mail senden' }).click();
      const response = await answer;
      expect(response.request().postDataJSON()).toEqual({ token: refused });
      expect(await response.json()).toEqual({ email: null, success: true });
    }

    // No address known and no token the API reads: the visitor types it.
    await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
    await page.getByLabel('E-Mail-Adresse').fill(user.email);
    const sent = page.waitForResponse((response) => response.url().includes('/send-verification-email'));
    await page.getByRole('button', { name: 'Neue E-Mail senden' }).click();
    expect((await sent).ok()).toBe(true);
    await expectNoSecrets(page, refused, user.email);
    // The typed address stays in the form: not in the history entry either, whatever key it might take.
    expect(await page.evaluate(() => JSON.stringify(window.history.state))).not.toContain(user.email);
  });
});
