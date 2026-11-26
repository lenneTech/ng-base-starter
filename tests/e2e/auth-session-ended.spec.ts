import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { fillInput, generateTestUser, gotoAndWaitForHydration, waitForHydration, waitForURLAndHydration } from '@lenne.tech/ng-base/testing';

import { API_BASE, DEFAULT_FEATURES, FRONTEND_BASE, parseFeatures, resetTestData, type Features } from './helpers/auth-backend';
import { registerUser } from './helpers/sign-in';

/**
 * A session the API ended signs the visitor out, and the next guarded page asks for a sign-in (Nuxt template:
 * `tests/e2e/auth-session-ended.spec.ts`; ng-base: the playground's "reload after the API ended the session").
 *
 * Since ng-base 22.1.4, `validateSession()` no longer trusts a cached user once `GET /iam/get-session` confirms that the
 * API has no session for them: the user is signed out, and the auth-state cookie with them. Before, the app looked signed
 * in (guards, header) until the first protected request failed. `DefaultLayout` calls `validateSession()` after the first
 * render in the browser, so a reload is enough. The next guarded page then goes to `/auth/login?redirect=<the page>`, and
 * the sign-in leads back to it.
 *
 * The session is ended where an expired or revoked session ends, on the API: `POST /iam/sign-out` with the browser's
 * session cookie, from a request context of its own, so the browser keeps its cookies and the auth-state cookie with the
 * user.
 *
 * Cookie mode only: with a stored JWT (`E2E_EXPECT_AUTH_MODE=jwt`) the user stays until a request fails, as in
 * nuxt-extensions; ng-base unit-tests that case. The e2e-auth job runs the spec once more against an API without JWT
 * (`NSC__BETTER_AUTH__JWT__ENABLED=false`, `/iam/features` reports `jwt: false`) with `E2E_SESSION_CASE=no-jwt`, which
 * makes it fail instead of passing when the API reports JWT on after all.
 */

/** The user in the app's auth-state cookie (`<prefix>-auth-state`), or null without one. */
async function authStateUser(context: BrowserContext): Promise<null | { email?: string }> {
  const state = (await context.cookies(FRONTEND_BASE)).find((cookie) => cookie.name.endsWith('-auth-state'));
  if (!state) {
    return null;
  }
  try {
    return (JSON.parse(decodeURIComponent(state.value)) as { user?: { email?: string } | null }).user ?? null;
  } catch {
    return null;
  }
}

let features: Features = { ...DEFAULT_FEATURES };

test.beforeAll(async ({ request }) => {
  features = parseFeatures(await (await request.get(`${API_BASE}/iam/features`)).json());
});

test.describe('A session the API ended', () => {
  const user = generateTestUser('session-ended');

  test.afterAll(async () => {
    await resetTestData(user.email);
  });

  test('signs the visitor out after a reload, and the next guarded page asks for a sign-in and leads back', async ({ page, playwright }) => {
    test.skip(process.env['E2E_EXPECT_AUTH_MODE']?.trim().toLowerCase() === 'jwt', 'Cookie mode only: a stored JWT keeps the user until a request fails');

    if (process.env['E2E_SESSION_CASE'] === 'no-jwt') {
      expect(features.jwt, 'E2E_SESSION_CASE=no-jwt, but /iam/features reports JWT on').toBe(false);
    }

    await resetTestData(user.email);
    await registerUser(page, user, features);
    await gotoAndWaitForHydration(page, '/app');
    await expect(page.getByRole('button', { name: 'Abmelden' }).first()).toBeVisible();
    expect((await authStateUser(page.context()))?.email).toBe(user.email);

    await test.step('the API ends the session; the browser keeps its cookies', async () => {
      const cookie = (await page.context().cookies(API_BASE)).map(({ name, value }) => `${name}=${value}`).join('; ');
      expect(cookie, 'the browser holds the session cookie').not.toBe('');
      const api = await playwright.request.newContext();
      try {
        const signOut = await api.post(`${API_BASE}/iam/sign-out`, { data: {}, headers: { Cookie: cookie, Origin: FRONTEND_BASE } });
        expect(signOut.ok(), `sign-out answered ${signOut.status()}`).toBe(true);
        const gone = (await (await api.get(`${API_BASE}/iam/get-session`, { headers: { Cookie: cookie } })).json()) as { session?: unknown } | null;
        expect(gone?.session ?? null, 'the API has no session for the cookie any more').toBeNull();
      } finally {
        await api.dispose();
      }
      expect((await authStateUser(page.context()))?.email, 'the auth-state cookie still names the user').toBe(user.email);
    });

    await test.step('after a reload the app signs the visitor out and stays on the page', async () => {
      await page.reload();
      await waitForHydration(page);
      await expect.poll(async () => authStateUser(page.context()), { timeout: 15000 }).toBeNull();
      await expect(page.getByRole('link', { name: 'Anmelden' }).first()).toBeVisible();
      await expect(page).toHaveURL(`${FRONTEND_BASE}/app`);
    });

    await test.step('the next guarded page asks for a sign-in, and the sign-in leads back to it', async () => {
      await page.getByRole('link', { name: /Sicherheit/ }).click();
      await waitForURLAndHydration(page, `${FRONTEND_BASE}/auth/login?redirect=%2Fapp%2Fsettings%2Fsecurity`, { timeout: 15000 });

      await fillInput(page, 'input[name$=".email"]', user.email);
      await fillInput(page, 'input[name$=".password"]', user.password);
      await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
      await waitForURLAndHydration(page, `${FRONTEND_BASE}/app/settings/security`, { timeout: 15000 });
      await expect(page.getByRole('heading', { name: 'Sicherheit', level: 1 })).toBeVisible();
    });
  });
});
