/**
 * The skip link of the auth layout jumps to the content and stays on the page. With `<base href="/">` a plain
 * `href="#main-content"` resolves to `/#main-content` and loads the home page, dropping the reset token or the
 * `?redirect=` of the page the keyboard user was on (found by the a11y review of 2026-11-06).
 */
import { expect, test } from '@playwright/test';
import { gotoAndWaitForHydration } from '@lenne.tech/ng-base/testing';

test('the skip link moves focus to the content without leaving the page', async ({ page }) => {
  await gotoAndWaitForHydration(page, '/auth/login?redirect=%2Fapp%2Fsettings%2Fsecurity');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fapp%2Fsettings%2Fsecurity$/);
  await expect(page.locator('main#main-content')).toBeFocused();
});
