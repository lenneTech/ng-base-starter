/**
 * The admin area goes by the user's role, without Better Auth's admin plugin, against a real API (the Nuxt template's
 * `tests/e2e/auth-admin-role.spec.ts`, #41).
 *
 * nest-server registers no `admin()` plugin, so every `admin.*` call of Better Auth's client answers 404. ng-base keeps
 * the client plugin off by default (`provideLtAuth({ enableAdmin })`, pinned for this app by
 * `tests/unit/auth-admin-plugin-contract.test.ts`). What decides about `/app/admin` is the role in the session: the
 * route guard with `isAdminUser`.
 *
 * This spec walks it: a user without the admin role signs in, opens the start page and the security settings, and is
 * sent from `/app/admin` back to `/app`. With the admin role granted and after a new sign-in, `/app/admin` and
 * `/app/admin/system` open. No request of the whole walk goes to `/iam/admin/*`.
 *
 * The role is granted in the database (`grantAdminRole`), because a test user cannot grant itself one through the API.
 * Needs the API, the app and the API's MongoDB, see `docs/e2e-auth.md`.
 */
import { expect, test } from '@playwright/test';
import { generateTestUser, gotoAndWaitForHydration } from '@lenne.tech/ng-base/testing';

import { API_BASE, DEFAULT_FEATURES, type Features, FRONTEND_BASE, grantAdminRole, parseFeatures, resetTestData } from './helpers/auth-backend';
import { loginWithEmail, registerUser } from './helpers/sign-in';

/** A request of Better Auth's admin plugin, directly or through the dev proxy (`/api/iam/admin/…`). */
function isAdminPluginRequest(url: string): boolean {
  return /\/iam\/admin(\/|$)/.test(new URL(url).pathname);
}

let ready = false;
let features: Features = { ...DEFAULT_FEATURES };

test.beforeAll(async ({ request }) => {
  try {
    ready = (await request.get(`${API_BASE}/`)).ok() && (await request.get(`${FRONTEND_BASE}/`)).ok();
  } catch {
    ready = false;
  }
  if (!ready) {
    console.error(`Admin role E2E needs the API (${API_BASE}) and the app (${FRONTEND_BASE}) running — see docs/e2e-auth.md`);
    return;
  }

  const featuresResponse = await request.get(`${API_BASE}/iam/features`);
  expect(featuresResponse.ok(), `GET ${API_BASE}/iam/features failed with ${featuresResponse.status()}`).toBeTruthy();
  features = parseFeatures(await featuresResponse.json());
});

test.describe('Admin area: the role decides, the admin plugin stays silent', () => {
  const user = generateTestUser('admin-role');

  test.afterAll(async () => {
    try {
      await resetTestData(user.email);
    } catch (error) {
      console.error(`  Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  test('without the role /app/admin leads to /app, with it the admin pages open, and no request goes to /iam/admin', async ({ page }) => {
    test.skip(!ready, 'Servers not running');

    const adminPluginRequests: string[] = [];
    page.context().on('request', (request) => {
      if (isAdminPluginRequest(request.url())) {
        adminPluginRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await resetTestData(user.email);
    await registerUser(page, user, features);

    await test.step('a user without the admin role: start page, security settings, no admin area', async () => {
      await gotoAndWaitForHydration(page, '/app');
      await expect(page.getByRole('heading', { level: 1, name: /Willkommen/ })).toBeVisible({ timeout: 10000 });

      await gotoAndWaitForHydration(page, '/app/settings/security');
      await expect(page.getByRole('heading', { level: 1, name: 'Sicherheit' })).toBeVisible({ timeout: 10000 });

      await gotoAndWaitForHydration(page, '/app/admin');
      await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10000 });
      await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toHaveCount(0);
    });

    await test.step('with the admin role and a new sign-in: the admin pages open', async () => {
      await grantAdminRole(user.email);
      await page.context().clearCookies();
      await loginWithEmail(page, user.email, user.password);

      await gotoAndWaitForHydration(page, '/app/admin');
      // Back on /app: the sign-in carried no admin role. Usually the API answered the roles from its 15-second cache,
      // which the database write does not reach; start it with PLAYWRIGHT=true.
      await expect(page, 'the new sign-in carries the admin role (API started with PLAYWRIGHT=true? see docs/e2e-auth.md)').toHaveURL(/\/app\/admin\/?$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible({ timeout: 10000 });

      await gotoAndWaitForHydration(page, '/app/admin/system');
      await expect(page.getByRole('heading', { level: 1, name: 'System' })).toBeVisible({ timeout: 10000 });
    });

    expect(adminPluginRequests, 'Better Auth admin plugin requests (nest-server serves no /iam/admin routes)').toEqual([]);
  });
});
