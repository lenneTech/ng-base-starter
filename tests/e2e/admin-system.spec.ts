/**
 * `/app/admin/system` when the API does not report its build, in the browser against a real API (found in a project,
 * DEV-4180; both starters get it; the component behaviour is pinned in `src/app/admin/system-page.spec.ts`).
 *
 * A failed `GET <api>/meta` is an error with "Erneut versuchen", never a silent "unbekannt". A retry that fails as well
 * says so with the time, and the focused button keeps the focus; a retry that succeeds removes the alert and moves the
 * focus to the API heading. The failure is simulated by answering `/meta` with 503 in the browser; the admin comes from
 * `grantAdminRole` (see `auth-admin-role.spec.ts` and `docs/e2e-auth.md`).
 */
import { expect, test, type Route } from '@playwright/test';
import { generateTestUser, gotoAndWaitForHydration } from '@lenne.tech/ng-base/testing';

import { API_BASE, DEFAULT_FEATURES, type Features, FRONTEND_BASE, grantAdminRole, parseFeatures, resetTestData } from './helpers/auth-backend';
import { loginWithEmail, registerUser } from './helpers/sign-in';

/** The API's `GET /meta`, directly or through the dev proxy (`/api/meta`); never the app's own `/api/build-identity`. */
function isMetaRequest(url: URL): boolean {
  return url.pathname.endsWith('/meta');
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
    console.error(`System page E2E needs the API (${API_BASE}) and the app (${FRONTEND_BASE}) running — see docs/e2e-auth.md`);
    return;
  }
  features = parseFeatures(await (await request.get(`${API_BASE}/iam/features`)).json());
});

test.describe('System page: the API does not report its build', () => {
  const admin = generateTestUser('admin-system');

  test.afterAll(async () => {
    try {
      await resetTestData(admin.email);
    } catch (error) {
      console.error(`  Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  test('a failed GET /meta is an error with a retry, and the retry recovers', async ({ page }) => {
    test.skip(!ready, 'Servers not running');

    await resetTestData(admin.email);
    await registerUser(page, admin, features);
    await grantAdminRole(admin.email);
    await page.context().clearCookies();
    await loginWithEmail(page, admin.email, admin.password);

    let failMeta = true;
    await page.route(isMetaRequest, async (route: Route) =>
      failMeta ? route.fulfill({ body: JSON.stringify({ message: 'down' }), contentType: 'application/json', status: 503 }) : route.continue(),
    );

    await gotoAndWaitForHydration(page, '/app/admin/system');
    await expect(page.getByRole('heading', { level: 1, name: 'System' })).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('API-Build nicht abrufbar')).toBeVisible();
    await expect(page.getByText('App und API laufen auf unterschiedlichen Builds')).toHaveCount(0);
    await expect(page.getByTestId('system-api-commit')).toHaveCount(0);

    // A retry that fails as well says so: in an outage the answer is instant, and an unchanged page would read as a
    // button that does nothing.
    const retry = page.getByRole('button', { name: 'Erneut versuchen' });
    await retry.click();
    await expect(page.getByTestId('system-api-failed')).toContainText(/Letzter Versuch um \d{2}:\d{2}:\d{2} Uhr: weiterhin keine Antwort\./);
    await expect(retry).toBeFocused();

    failMeta = false;
    await retry.click();

    await expect(page.getByText('API-Build nicht abrufbar')).toHaveCount(0);
    await expect(page.getByTestId('system-api-commit')).toBeVisible();
    // The focused button is gone with the alert; focus lands on the API figures, not on <body>.
    await expect(page.getByRole('heading', { level: 3, name: 'API (Backend)' })).toBeFocused();
  });
});
