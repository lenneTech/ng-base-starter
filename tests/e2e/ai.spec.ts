import { expect, test } from '@playwright/test';

// AI assistant route protection. The conversational flow itself requires a
// running backend with a configured LLM connection and is covered by the
// nest-server AI e2e tests; here we verify the frontend wiring + access control.
//
// Routes covered (all unauthenticated cases — non-admin and admin cases require
// authenticated fixtures and live in the broader auth e2e suite):
//   /app/ai                              (any authenticated user)
//   /app/settings/ai                     (any authenticated user)
//   /app/settings/ai-prompts             (any authenticated user)
//   /app/admin/ai/connections            (admin only)
//   /app/admin/ai/budgets                (admin only)
//   /app/admin/ai/interactions           (admin only)
//   /app/admin/ai/preferences            (admin only)
//   /app/admin/ai/prompt-hints           (admin only)
//   /app/admin/ai/slots                  (admin only)
test.describe('AI assistant — unauthenticated', () => {
  for (const path of ['/app/ai', '/app/settings/ai', '/app/settings/ai-prompts'] as const) {
    test(`redirects unauthenticated users away from ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      // Tightened — must land on /auth/login (NOT /app or anywhere else). The previous
      // `/\/auth\/login|\/app(\/|$)/` regex collapsed unauth-redirect and non-admin-redirect
      // into a single PASS, hiding regressions in either branch.
      await expect(page).toHaveURL(/\/auth\/login/);
    });
  }

  for (const path of [
    '/app/admin/ai/connections',
    '/app/admin/ai/budgets',
    '/app/admin/ai/interactions',
    '/app/admin/ai/preferences',
    '/app/admin/ai/prompt-hints',
    '/app/admin/ai/slots',
  ] as const) {
    test(`redirects unauthenticated users away from admin page ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      // admin.global runs auth check first → unauth users always land on /auth/login.
      await expect(page).toHaveURL(/\/auth\/login/);
    });
  }
});
