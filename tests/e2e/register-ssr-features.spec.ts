import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { generateTestUser } from '@lenne.tech/ng-base/testing';

import { API_BASE, FRONTEND_BASE, releaseSystemSetupClaim, resetTestData } from './helpers/auth-backend';

/**
 * The register form depends on backend feature flags — `signUpChecks` adds the
 * terms checkbox. `useLtAuth()` fetches those flags on the CLIENT only, so the
 * server rendered the form without the checkbox and the client, once the flags
 * arrived, with it. In the production build the flags arrive before hydration
 * finishes, and every visit to /auth/register logged "Hydration completed but
 * contains mismatches". In `nuxt dev` the client is slow enough to hydrate first,
 * so the mismatch never shows locally.
 *
 * Asserted on the SERVER html rather than in the browser for exactly that reason:
 * the console error depends on timing, the server html does not.
 *
 * Knowing the flags on the server has a side effect on disabled sign-up: the page's
 * redirect watcher would fire there, and a server redirect carries no payload, so the
 * toast explaining it was lost. The second test pins that the redirect stays on the
 * client; it only runs against a backend with sign-up disabled.
 *
 * Independent of the database state: a spec before this one may have deleted every
 * user, and with zero users the setup middleware redirects /auth/register to
 * /auth/setup — the page under test would never render. The system is set up through
 * the API when needed, and that admin is removed afterwards. If init answers 403 with
 * zero users, a previous spec left its `system-setup-locks` claim behind (see the
 * nest-server system-setup INTEGRATION-CHECKLIST).
 */
test.describe('Register page renders its feature-dependent fields on the server', () => {
  const admin = generateTestUser('register-ssr');
  let createdAdmin = false;

  test.beforeAll(async ({ request }) => {
    const status = (await (await request.get(`${API_BASE}/system-setup/status`)).json()) as { needsSetup?: boolean };
    if (status.needsSetup) {
      const res = await request.post(`${API_BASE}/system-setup/init`, {
        data: { email: admin.email, name: admin.name, password: createHash('sha256').update(admin.password).digest('hex') },
      });
      expect(res.ok(), `system setup failed: ${res.status()}`).toBe(true);
      createdAdmin = true;
    }
  });

  test.afterAll(async () => {
    if (createdAdmin) {
      await resetTestData(admin.email);
      // A successful init keeps its setup claim. Without releasing it, the next run within five
      // minutes gets 403 from init although no user is left.
      await releaseSystemSetupClaim();
    }
  });

  test('the terms checkbox is in the server html exactly when the backend requires it', async ({ request }) => {
    const features = (await (await request.get(`${API_BASE}/iam/features`)).json()) as { signUpChecks?: boolean };

    const res = await request.get(`${FRONTEND_BASE}/auth/register`, { headers: { 'Accept-Language': 'de' } });
    expect(res.ok()).toBe(true);
    expect(new URL(res.url()).pathname, 'must render the register page, not a redirect').toBe('/auth/register');
    const html = await res.text();

    // The checkbox label links to the terms page; nothing else on the auth page does.
    expect(html.includes('href="/legal/terms"'), `signUpChecks=${features.signUpChecks}`).toBe(features.signUpChecks === true);
  });

  test('with sign-up disabled, the redirect to login keeps its explanation', async ({ page, request }) => {
    const features = (await (await request.get(`${API_BASE}/iam/features`)).json()) as { signUpEnabled?: boolean };
    test.skip(features.signUpEnabled !== false, 'Sign-up is enabled in the current config');

    // The server knows the flags now as well, but a redirect issued there is a bare 302 without
    // a payload, which drops the toast. The page has to render and leave the redirect to the client.
    const res = await request.get(`${FRONTEND_BASE}/auth/register`, { maxRedirects: 0 });
    expect(res.status(), 'the server must not redirect').toBe(200);

    await page.goto('/auth/register');
    await expect(page.getByText('Registrierung nicht verfügbar').first()).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login$/);
  });
});
