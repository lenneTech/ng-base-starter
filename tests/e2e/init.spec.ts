import { test } from '@playwright/test';

test('init test', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});
