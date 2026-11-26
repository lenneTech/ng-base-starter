import { createHash } from 'node:crypto';

import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';
import { generateTestUser, gotoAndWaitForHydration } from '@lenne.tech/ng-base/testing';

import { API_BASE, FRONTEND_BASE, parseFeatures, releaseSystemSetupClaim, resetTestData, type Features } from './helpers/auth-backend';

/**
 * The sign-in methods of the login page, against a REAL API: `GET /iam/features` decides what the page offers, and the
 * server HTML shows it already (Nuxt template: `tests/e2e/auth-sign-in-methods.spec.ts`).
 *
 * - `emailAndPassword: false` (nest-server 12.11.0+, an API that signs in through providers alone): no form, no
 *   "Passwort vergessen?", no "Registrieren"; `/auth/register` and `/auth/forgot-password` send the visitor to the
 *   login. Without the field (an older API) the form stays.
 * - `passkey: false`: no passkey button. 12.11.0 reports it for provider-only sign-in by default.
 * - One button per provider in `socialProviders`, and a hint when no method is left at all.
 *
 * The spec runs against whatever the API is configured for. Against nest-server-starter as it ships (`emailAndPassword`
 * on) it checks that nothing changed. The provider-only case needs an API started with
 *
 *   NSC__BETTER_AUTH__EMAIL_AND_PASSWORD__ENABLED=false
 *   NSC__BETTER_AUTH__SOCIAL_PROVIDERS__GITHUB__CLIENT_ID=<any value>
 *   NSC__BETTER_AUTH__SOCIAL_PROVIDERS__GITHUB__CLIENT_SECRET=<any value>
 *
 * (the button only starts the round trip, which this spec never takes, so the values need not be real). With
 * `E2E_SIGN_IN_CASE=providers-only` the spec fails instead of skipping when the API offers e-mail and password after
 * all: a run meant for that case must not report green without having seen it. The `e2e-auth` job in
 * `.github/workflows/test.yml` runs it once that way, on the empty database before the suite.
 *
 * Independent of the database state, as `register-ssr-features.spec.ts`: with zero users and the HTTP init open, every
 * page goes to `/auth/setup`, so the system is set up through the API when needed and that admin is removed afterwards.
 * With the HTTP init closed the pages stay reachable without a user. The system setup creates its admin without Better
 * Auth's e-mail sign-up, so it works with e-mail and password off too.
 */

const PROVIDERS_ONLY = process.env['E2E_SIGN_IN_CASE'] === 'providers-only';

/** A provider button ("Mit GitHub anmelden"), not the passkey button. */
const PROVIDER_BUTTON = /^Mit (?!Passkey\b).+ anmelden$/;
const PROVIDER_BUTTON_IN_HTML = /Mit (?!Passkey\b)[^<>]+? anmelden/g;

/**
 * The provider ids the page shows a button for: strings, trimmed, not empty, each once. The same rule as
 * `socialProvidersOf()` in `src/app/auth/social-providers.ts`, which this spec does not import (it pulls the icon
 * packages into the test run).
 */
function shownProviders(features: Features): string[] {
  const listed: unknown = features.socialProviders;
  return Array.isArray(listed) ? [...new Set(listed.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))] : [];
}

/** What the login page has to offer for `features`. */
function expectedMethods(features: Features) {
  const password = features.emailAndPassword !== false;
  const passkey = features.passkey !== false;
  const providers = shownProviders(features).length;
  return {
    forgotPassword: password,
    hint: !password && !passkey && providers === 0,
    passkey,
    password,
    providers,
    register: password && features.signUpEnabled !== false,
  };
}

/** Collects what Angular logs about hydration (NG0500 to NG0507: a server DOM the browser does not match). */
function hydrationMessages(page: Page): string[] {
  const messages: string[] = [];
  page.on('console', (message) => {
    if (/NG05\d\d|hydration/i.test(message.text()) && (message.type() === 'error' || message.type() === 'warning')) {
      messages.push(message.text());
    }
  });
  return messages;
}

test.describe('Sign-in methods follow /iam/features', () => {
  const admin = generateTestUser('sign-in-methods');
  let createdAdmin = false;
  let features: Features;

  test.beforeAll(async ({ request }) => {
    features = parseFeatures(await (await request.get(`${API_BASE}/iam/features`)).json());

    const status = (await (await request.get(`${API_BASE}/system-setup/status`)).json()) as { httpInitEnabled?: boolean; needsSetup?: boolean };
    if (status.needsSetup && status.httpInitEnabled !== false) {
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
      // A successful init keeps its setup claim; without releasing it, the next run within five minutes gets 403 from
      // init although no user is left.
      await releaseSystemSetupClaim();
    }
  });

  test('the API runs the configuration this run asked for', () => {
    test.skip(!PROVIDERS_ONLY, 'E2E_SIGN_IN_CASE=providers-only is not set');

    expect(features.emailAndPassword, 'E2E_SIGN_IN_CASE=providers-only, but /iam/features reports e-mail and password on').toBe(false);
    expect(shownProviders(features).length, 'E2E_SIGN_IN_CASE=providers-only, but /iam/features lists no provider').toBeGreaterThan(0);
  });

  test('the server HTML of the login page offers exactly the methods the API reports', async ({ request }) => {
    const expected = expectedMethods(features);

    const res = await request.get(`${FRONTEND_BASE}/auth/login`, { headers: { 'Accept-Language': 'de' } });
    expect(res.ok()).toBe(true);
    expect(new URL(res.url()).pathname, 'must render the login page, not a redirect').toBe('/auth/login');
    const html = await res.text();

    const context = JSON.stringify(features);
    expect(html.includes('autocomplete="current-password"'), `password field, features ${context}`).toBe(expected.password);
    expect(html.includes('href="/auth/forgot-password"'), `"Passwort vergessen?", features ${context}`).toBe(expected.forgotPassword);
    expect(html.includes('href="/auth/register"'), `"Registrieren", features ${context}`).toBe(expected.register);
    expect(html.includes('Mit Passkey anmelden'), `passkey button, features ${context}`).toBe(expected.passkey);
    expect(html.match(PROVIDER_BUTTON_IN_HTML)?.length ?? 0, `provider buttons, features ${context}`).toBe(expected.providers);
    expect(html.includes('Anmeldung nicht möglich'), `hint, features ${context}`).toBe(expected.hint);
  });

  test('in the browser the page keeps those methods after hydration, without a mismatch', async ({ page }) => {
    const expected = expectedMethods(features);
    const hydration = hydrationMessages(page);

    await gotoAndWaitForHydration(page, '/auth/login');

    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
    await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(expected.password ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Passwort vergessen?' })).toHaveCount(expected.forgotPassword ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Registrieren' })).toHaveCount(expected.register ? 1 : 0);
    await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toHaveCount(expected.passkey ? 1 : 0);
    await expect(page.getByRole('button', { name: PROVIDER_BUTTON })).toHaveCount(expected.providers);
    await expect(page.getByText('Anmeldung nicht möglich')).toHaveCount(expected.hint ? 1 : 0);
    expect(hydration).toEqual([]);
  });

  test('with e-mail and password off, the register page sends the visitor to the login and says why', async ({ page, request }) => {
    test.skip(features.emailAndPassword !== false, 'E-mail and password sign-in is on in the current config');

    // As with sign-up closed: a redirect issued by the server is a bare 302 without a payload, which drops the toast.
    // The page renders and leaves the redirect to the client.
    const res = await request.get(`${FRONTEND_BASE}/auth/register`, { maxRedirects: 0 });
    expect(res.status(), 'the server must not redirect').toBe(200);

    await gotoAndWaitForHydration(page, '/');
    await page.goto('/auth/register');
    await expect(page.getByText('Registrierung nicht verfügbar').filter({ visible: true })).toHaveCount(1);
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(0);

    // The redirect replaced the history entry: "Zurück" goes to the page before, not to /auth/register, which would
    // send the visitor to the login again with one more toast.
    await page.goBack();
    await expect(page).toHaveURL(`${FRONTEND_BASE}/`);
  });

  test('with e-mail and password off, the forgot-password page sends the visitor to the login and says why', async ({ page, request }) => {
    test.skip(features.emailAndPassword !== false, 'E-mail and password sign-in is on in the current config');

    // There is no password to reset: the login page hides the link, a bookmark still lands here.
    const res = await request.get(`${FRONTEND_BASE}/auth/forgot-password`, { maxRedirects: 0 });
    expect(res.status(), 'the server must not redirect').toBe(200);

    await gotoAndWaitForHydration(page, '/');
    await page.goto('/auth/forgot-password');
    await expect(page.getByText('Passwort zurücksetzen nicht verfügbar').filter({ visible: true })).toHaveCount(1);
    await expect(page).toHaveURL(/\/auth\/login$/);

    await page.goBack();
    await expect(page).toHaveURL(`${FRONTEND_BASE}/`);
  });
});
