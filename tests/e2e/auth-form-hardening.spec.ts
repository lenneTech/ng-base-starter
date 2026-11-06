import { expect, test } from '@playwright/test';

import { safeFormSubmit } from './helpers/safe-form-submit';

// Regression guard for the capture-phase preventDefault attached in
// pages/auth/login.vue + pages/auth/register.vue. A racey/early submit (typed
// password + Enter before Vue hydration is fully wired) must NOT cause the
// native form GET that would leak credentials into the URL.
//
// We use `safeFormSubmit` to dispatch the submit deterministically via the
// browser API (`form.requestSubmit()`) instead of a timer-based `Enter` +
// `waitForTimeout` race. The helper waits a short moment for hydration and
// then triggers the submit so we exercise the SAME code path automation
// drivers (Chrome DevTools MCP, Playwright) hit in real tests.
test.describe('Auth form hardening', () => {
  test('login page does not native-GET-submit even on a very fast submit', async ({ page }) => {
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill('race@test.com');
    await page.locator('input[type="password"]').fill('SuperSecret123!');
    // Trigger the submit via the browser API in the same tick the helper would.
    const result = await page.evaluate(safeFormSubmit, { delayMs: 50 });
    expect(result.ok, result.reason).toBe(true);
    // POSITIVE assertion: still on /auth/login (no navigation), credentials
    // never in the URL. Either failure mode (navigated away OR credentials in
    // URL) means the capture-phase guard regressed.
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page).not.toHaveURL(/password=/);
  });

  test('register page does not native-GET-submit either', async ({ page }) => {
    await page.goto('/auth/register', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill('race-register@test.com');
    await page.locator('input[type="password"]').first().fill('SuperSecret123!');
    await page.locator('input[type="password"]').nth(1).fill('SuperSecret123!');
    const result = await page.evaluate(safeFormSubmit, { delayMs: 50 });
    expect(result.ok, result.reason).toBe(true);
    await expect(page).toHaveURL(/\/auth\/register/);
    await expect(page).not.toHaveURL(/password=/);
  });
});
