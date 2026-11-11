import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';
import { waitForHydration } from '@lenne.tech/ng-base/testing';

/**
 * Regression guard for the production reset-link lockout.
 *
 * `runtimeConfig.public.siteUrl` was never declared, so `config.public.siteUrl` was
 * `undefined` and the template literal at the call site produced the literal text
 * `"undefined/auth/reset-password"`. Better Auth answered 403 INVALID_REDIRECT_URL,
 * no reset mail was ever sent, and users who had forgotten their password were locked
 * out. Nothing in the suite noticed, because nothing exercised this page.
 *
 * The assertion here is on the OUTGOING request body rather than on a mailbox: the
 * `redirectTo` value is what Better Auth validates and what ends up in the mailed
 * link, so pinning it catches the whole failure class — a missing config key, a
 * broken origin resolver, or a call site that regresses to interpolation — without
 * needing mail infrastructure.
 *
 * `tests/unit/runtime-config-contract.test.ts` guards the same bug at the config
 * level; this one guards it at the call site.
 */

// Same convention as the other e2e specs: never hardcode the port — the suite runs
// under classic ports, `lt dev up` (https://<slug>.localhost) and CI alike.
const FRONTEND_BASE = process.env.NG_PUBLIC_SITE_URL || process.env.APP_URL || 'http://localhost:3001';

/**
 * Answer the reset endpoint with Better Auth's success shape.
 *
 * What this spec verifies is what the APP sends and how it behaves afterwards — the
 * request body it builds, and the confirmation UI. Neither depends on a live backend,
 * and stubbing keeps the spec deterministic and runnable without one.
 *
 * The other half — redeeming the token in the browser and proving the credential
 * actually changed — is `auth-lifecycle.spec.ts` Step 9, against a real Better Auth.
 * This header claimed that coverage before it existed: the lifecycle spec ran nine
 * steps and none of them touched a password reset. A pointer to coverage that is not
 * there is worse than no pointer, because it answers the question "is this tested?"
 * with a confident yes.
 */
async function stubResetEndpoint(page: Page): Promise<void> {
  await page.route('**/request-password-reset', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ status: true }),
      contentType: 'application/json',
      status: 200,
    });
  });
}

test.describe('Password reset request', () => {
  test('the login page reaches "Passwort vergessen?" by keyboard', async ({ page }) => {
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);

    // The link carried tabindex="-1", so a keyboard user could not reach the reset at all (WCAG 2.1.1). After the
    // password field come its show/hide button and then the link.
    const link = page.getByRole('link', { name: 'Passwort vergessen?' });
    await page.locator('#login-password').focus();
    for (let presses = 0; presses < 3 && !(await link.evaluate((el) => el === document.activeElement)); presses++) {
      await page.keyboard.press('Tab');
    }
    await expect(link).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/auth\/forgot-password$/);
  });

  test('sends an absolute redirectTo built from the app origin', async ({ page }) => {
    await page.goto('/auth/forgot-password', { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);
    await stubResetEndpoint(page);

    const requestPromise = page.waitForRequest((request) => request.url().includes('/request-password-reset') && request.method() === 'POST');

    await page.getByRole('textbox', { name: /e-mail/i }).fill('reset-flow@test.com');
    await page.getByRole('button', { name: 'Link anfordern' }).click();

    const body = JSON.parse((await requestPromise).postData() ?? '{}');

    // The exact expected value, not merely "does not contain undefined" — a wrong
    // but plausible origin (the API host, a stale env, `window.location.href` with
    // its path) is the failure mode that actually recurs.
    expect(body.redirectTo).toBe(`${FRONTEND_BASE}/auth/reset-password`);
    expect(body.email).toBe('reset-flow@test.com');
  });

  test('shows the non-enumerating confirmation and offers a way back', async ({ page }) => {
    await page.goto('/auth/forgot-password', { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);
    await stubResetEndpoint(page);

    await page.getByRole('textbox', { name: /e-mail/i }).fill('unknown-account@test.com');
    await page.getByRole('button', { name: 'Link anfordern' }).click();

    // Better Auth answers identically for an unknown address, so the copy must be
    // conditional — claiming a mail was sent would be untrue here, and it steers the
    // user away from the most common real cause: a mistyped address.
    const confirmation = page.getByRole('status');
    await expect(confirmation).toContainText(/falls ein konto/i);
    await expect(confirmation).toContainText('unknown-account@test.com');

    // The success screen used to be a dead end: no way back to the form without a
    // page reload, and no way to resend.
    await expect(page.getByRole('button', { name: /neue e-mail senden/i })).toBeVisible();
    await page.getByRole('button', { name: /andere e-mail-adresse verwenden/i }).click();
    await expect(page.getByRole('textbox', { name: /e-mail/i })).toBeVisible();
  });

  test('exposes the email field to password managers', async ({ page }) => {
    await page.goto('/auth/forgot-password', { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);

    // NuxtUI defaults `autocomplete` to "off", which suppresses autofill on exactly
    // the form where a user who lost their credentials most needs it (WCAG 1.3.5).
    await expect(page.getByRole('textbox', { name: /e-mail/i })).toHaveAttribute('autocomplete', 'email');
  });

  test('gives the page its own heading and title', async ({ page }) => {
    await page.goto('/auth/forgot-password', { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);

    // UAuthForm's `title` prop renders a plain <div>, so the page had no heading at
    // all in its form state, and all seven auth pages shared one browser title.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Passwort vergessen');
    await expect(page).toHaveTitle(/Passwort vergessen/);
  });
});
