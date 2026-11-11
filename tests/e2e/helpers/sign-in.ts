/**
 * UI steps the admin specs share: sign in with e-mail and password, and register a user that ends signed in on `/app`
 * whatever the backend scenario (with or without e-mail verification, with or without the terms checkbox). The same
 * selectors as `auth-lifecycle.spec.ts`: Signal Forms name the inputs `<form>.<field>`.
 */
import { expect, type Page } from '@playwright/test';
import { fillInput, gotoAndWaitForHydration, waitForURLAndHydration } from '@lenne.tech/ng-base/testing';

import { type Features, waitForVerificationToken } from './auth-backend';

/** Sign in with e-mail and password and wait for the app. */
export async function loginWithEmail(page: Page, email: string, password: string): Promise<void> {
  await gotoAndWaitForHydration(page, '/auth/login');
  await page.locator('input[name$=".email"]').waitFor({ state: 'visible', timeout: 10000 });
  await fillInput(page, 'input[name$=".email"]', email);
  await fillInput(page, 'input[name$=".password"]', password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
}

/** Register through the UI and end signed in on `/app`, whatever the backend scenario. */
export async function registerUser(page: Page, user: { email: string; name: string; password: string }, features: Features): Promise<void> {
  await gotoAndWaitForHydration(page, '/auth/register');
  await page.locator('input[name$=".name"]').waitFor({ state: 'visible', timeout: 10000 });
  await fillInput(page, 'input[name$=".name"]', user.name);
  await fillInput(page, 'input[name$=".email"]', user.email);
  await fillInput(page, 'input[name$=".password"]', user.password);
  await fillInput(page, 'input[name$=".confirmPassword"]', user.password);

  if (features.signUpChecks) {
    // Spartan's checkbox is a button[role=checkbox]: click, then wait for the state Angular renders on the next change
    // detection, which Playwright's check() does not wait for.
    const termsCheckbox = page.getByRole('checkbox', { name: /akzeptiere die AGB/i });
    await termsCheckbox.waitFor({ state: 'visible', timeout: 5000 });
    await termsCheckbox.click();
    await expect(termsCheckbox).toBeChecked();
  }

  await page.getByRole('button', { name: 'Konto erstellen' }).click();

  if (features.emailVerification) {
    await waitForURLAndHydration(page, /\/auth\/verify-email/, { timeout: 15000 });
    const token = await waitForVerificationToken(user.email);
    expect(token, 'Verification token not found in server logs').not.toBeNull();
    await gotoAndWaitForHydration(page, `/auth/verify-email?token=${token}`);
    await expect(page.getByRole('heading', { name: 'E-Mail bestätigt' })).toBeVisible({ timeout: 15000 });
    await loginWithEmail(page, user.email, user.password);
  } else {
    const laterButton = page.getByRole('button', { name: 'Später einrichten' });
    await laterButton.waitFor({ state: 'visible', timeout: 10000 });
    await laterButton.click();
    await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
  }
}
