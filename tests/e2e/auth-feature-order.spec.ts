/**
 * Auth E2E — prerequisites, the four backend configuration scenarios and how to run them all:
 * see `docs/e2e-auth.md`. The suite detects the live configuration via GET /iam/features and
 * skips whatever does not apply.
 */

import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { extractTOTPSecret, fillInput, generateTestUser, generateTOTP, gotoAndWaitForHydration, waitForURLAndHydration } from '@lenne.tech/ng-base/testing';

import { API_BASE, DEFAULT_FEATURES, FRONTEND_BASE, parseFeatures, resetTestData, waitForVerificationToken, type Features } from './helpers/auth-backend';

/**
 * Register a new user via UI.
 * Adapts to current configuration (terms checkbox, email verification).
 */
async function registerUser(page: Page, user: { email: string; password: string; name: string }, features: Features): Promise<void> {
  await gotoAndWaitForHydration(page, '/auth/register');
  await page.locator('input[name$=".name"]').waitFor({ state: 'visible', timeout: 10000 });

  await fillInput(page, 'input[name$=".name"]', user.name);
  await fillInput(page, 'input[name$=".email"]', user.email);
  await fillInput(page, 'input[name$=".password"]', user.password);
  await fillInput(page, 'input[name$=".confirmPassword"]', user.password);

  // Accept terms if signUpChecks is enabled
  if (features.signUpChecks) {
    const termsCheckbox = page.getByRole('checkbox', { name: /akzeptiere die AGB/i });
    await termsCheckbox.waitFor({ state: 'visible', timeout: 5000 });
    await termsCheckbox.click();
    await expect(termsCheckbox).toBeChecked();
  }

  await page.getByRole('button', { name: 'Konto erstellen' }).click();

  if (features.emailVerification) {
    // Wait for redirect to verify-email page
    await waitForURLAndHydration(page, /\/auth\/verify-email/, { timeout: 15000 });

    // Extract token from backend logs and verify email
    const token = await waitForVerificationToken(user.email);
    expect(token, 'Verification token not found in server logs').not.toBeNull();

    await gotoAndWaitForHydration(page, `/auth/verify-email?token=${token}`);
    await expect(page.getByRole('heading', { name: 'E-Mail bestätigt' })).toBeVisible({ timeout: 15000 });

    // Login after verification
    await page.getByRole('link', { name: 'Jetzt anmelden' }).click();
    await waitForURLAndHydration(page, /\/auth\/login/, { timeout: 10000 });
    await loginWithEmail(page, user.email, user.password);
    await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
  } else {
    // Wait for passkey prompt and dismiss it
    const laterButton = page.getByRole('button', { name: 'Später einrichten' });
    await laterButton.waitFor({ state: 'visible', timeout: 10000 });
    await laterButton.click();
    await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
  }
}

/**
 * Login with email and password via UI
 */
async function loginWithEmail(page: Page, email: string, password: string): Promise<void> {
  await gotoAndWaitForHydration(page, '/auth/login');
  await page.locator('input[name$=".email"]').waitFor({ state: 'visible', timeout: 10000 });
  await fillInput(page, 'input[name$=".email"]', email);
  await fillInput(page, 'input[name$=".password"]', password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
}

/**
 * Enable 2FA and return the TOTP secret.
 * Uses network interception to extract the TOTP URI (QR code is SVG via v-html).
 */
async function enable2FA(page: Page, password: string): Promise<string> {
  await gotoAndWaitForHydration(page, '/app/settings/security');

  const enableButton = page.getByRole('button', { name: '2FA aktivieren' });
  await enableButton.waitFor({ state: 'visible', timeout: 10000 });

  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.click();
  await page.keyboard.type(password, { delay: 5 });

  // Intercept the 2FA enable response to extract TOTP URI
  const responsePromise = page.waitForResponse((resp) => resp.url().includes('/two-factor/enable') && resp.status() === 200);

  await enableButton.click();

  const response = await responsePromise;
  const responseBody = await response.json();

  // Assert the DISCRIMINANT before anything else, because it is the one field whose
  // absence this test would otherwise blame on the wrong thing.
  //
  // better-auth >= 1.7 answers with `{ method: 'otp' | 'totp', ... }`, and the security
  // page narrows on it before reading totpURI. A 1.6.x SERVER answers 200 with a valid
  // totpURI and NO `method` — so every assertion below still passes, the page silently
  // bails out of the flow, and the run dies further down on `.bg-white svg` with a
  // locator timeout. That message sends the reader into QR rendering; the actual cause
  // is an api and an app on different better-auth versions, and it is sitting right
  // here in a response body the test already parsed.
  const method = responseBody.method ?? responseBody.data?.method;
  expect(
    method,
    'No `method` in the 2FA enable response. That field exists from better-auth 1.7 — ' +
      'the API is almost certainly on an older version than the app. Compare better-auth ' +
      'in projects/api and projects/app; they must be identical.',
  ).toBe('totp');

  const totpUri = responseBody.totpURI || responseBody.data?.totpURI;
  expect(totpUri, '2FA enable response should contain totpURI').toBeTruthy();

  const secret = extractTOTPSecret(totpUri);
  expect(secret).not.toBeNull();

  // Wait for QR code SVG to render
  await page.locator('.bg-white svg').waitFor({ state: 'visible', timeout: 10000 });

  // Verify TOTP
  const totpCode = generateTOTP(secret!);
  await fillInput(page, 'input[placeholder="000000"]', totpCode);
  await page.getByRole('button', { name: 'Verifizieren' }).click();

  // Close backup codes dialog
  await expect(page.getByRole('heading', { name: 'Backup-Codes' })).toBeVisible({ timeout: 10000 });
  await page.keyboard.press('Escape');

  return secret!;
}

/**
 * Cleanup Virtual Authenticator
 */
async function cleanupAuthenticator(cdpSession: CDPSession, authenticatorId: string): Promise<void> {
  try {
    await cdpSession.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdpSession.send('WebAuthn.disable');
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// API Availability & Feature Detection
// =============================================================================

let apiAvailable = false;
let features: Features | null = null;

test.beforeAll(async ({ request }) => {
  let frontendAvailable = false;

  try {
    const apiResponse = await request.get(`${API_BASE}/`);
    apiAvailable = apiResponse.ok();
  } catch {
    apiAvailable = false;
  }

  try {
    const frontendResponse = await request.get(`${FRONTEND_BASE}/`);
    frontendAvailable = frontendResponse.ok();
  } catch {
    frontendAvailable = false;
  }

  if (!apiAvailable || !frontendAvailable) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║  E2E TESTS REQUIRE RUNNING SERVERS                           ║');
    console.error('╠══════════════════════════════════════════════════════════════╣');
    console.error(`║  ${apiAvailable ? '✓' : '✗'} API Server (localhost:3000)     ║`);
    console.error(`║  ${frontendAvailable ? '✓' : '✗'} Frontend (localhost:3001)  ║`);
    console.error('╚══════════════════════════════════════════════════════════════╝');
    apiAvailable = false;
    return;
  }

  apiAvailable = true;

  // Detect backend configuration
  try {
    const featuresResponse = await request.get(`${API_BASE}/iam/features`);
    expect(featuresResponse.ok(), `GET ${API_BASE}/iam/features failed with ${featuresResponse.status()}`).toBeTruthy();
    features = parseFeatures(await featuresResponse.json());
  } catch {
    features = { ...DEFAULT_FEATURES };
  }
});

// =============================================================================
// Test 1: Register -> 2FA -> Passkey (without logout)
// =============================================================================

test.describe.serial('Test 1: Register -> 2FA -> Passkey (no logout)', () => {
  const testUser = generateTestUser('2fa-then-passkey');

  test.afterAll(async () => {
    await resetTestData(testUser.email);
  });

  test('Register, enable 2FA, then add Passkey without logout', async ({ page, context }) => {
    test.skip(!apiAvailable, 'Servers not running');

    // Register (adapts to config)
    await registerUser(page, testUser, features!);

    // Enable 2FA
    await enable2FA(page, testUser.password);

    // Add Passkey
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('WebAuthn.enable');

    const { authenticatorId } = await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });

    try {
      await gotoAndWaitForHydration(page, '/app/settings/security');
      await page.getByRole('button', { name: 'Passkey hinzufügen' }).click();
      await page.getByPlaceholder('Name für den Passkey').fill('After-2FA-Passkey');
      await page.getByRole('button', { name: 'Hinzufügen' }).click();

      await expect(page.getByText('After-2FA-Passkey')).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('2FA ist aktiviert')).toBeVisible();
    } finally {
      await cleanupAuthenticator(cdpSession, authenticatorId);
    }
  });
});

// =============================================================================
// Test 2: Register -> Passkey -> 2FA (without logout)
// =============================================================================

test.describe.serial('Test 2: Register -> Passkey -> 2FA (no logout)', () => {
  const testUser = generateTestUser('passkey-then-2fa');

  test.afterAll(async () => {
    await resetTestData(testUser.email);
  });

  test('Register, add Passkey, then enable 2FA without logout', async ({ page, context }) => {
    test.skip(!apiAvailable, 'Servers not running');

    // Register (adapts to config)
    await registerUser(page, testUser, features!);

    // Add Passkey first
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('WebAuthn.enable');

    const { authenticatorId } = await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });

    try {
      await gotoAndWaitForHydration(page, '/app/settings/security');
      await page.getByRole('button', { name: 'Passkey hinzufügen' }).click();
      await page.getByPlaceholder('Name für den Passkey').fill('Before-2FA-Passkey');
      await page.getByRole('button', { name: 'Hinzufügen' }).click();

      await expect(page.getByText('Before-2FA-Passkey')).toBeVisible({ timeout: 15000 });

      // Enable 2FA
      await enable2FA(page, testUser.password);

      // Verify both are active
      await gotoAndWaitForHydration(page, '/app/settings/security');
      await expect(page.getByText('2FA ist aktiviert')).toBeVisible();
      await expect(page.getByText('Before-2FA-Passkey')).toBeVisible();
    } finally {
      await cleanupAuthenticator(cdpSession, authenticatorId);
    }
  });
});

// =============================================================================
// Test 3: Error Translations
// =============================================================================

test.describe('Test 3: Error Translations', () => {
  test('3.1 Invalid credentials shows German error message', async ({ page }) => {
    test.skip(!apiAvailable, 'Servers not running');

    await loginWithEmail(page, 'invalid@test.com', 'WrongPassword123!');

    // The backend returns "#LTNS_0010: Invalid credentials"; the app translates
    // it and surfaces it as a NuxtUI toast in the Notifications region. Assert on
    // the translated text (role-agnostic — NuxtUI toast markup is not `li[role=alert]`
    // and the toast title/heading text is not stable across versions).
    // The region label follows the app locale since @nuxt/ui 4.12 (`toaster.viewport`:
    // "Benachrichtigungen (F8)" under `de`); 4.11 hard-coded "Notifications (F8)".
    const notifications = page.getByRole('region', { name: /Benachrichtigungen|Notifications/i });
    await expect(notifications.getByText('Ungültige Anmeldedaten')).toBeVisible({ timeout: 10000 });
  });

  test('3.2 Error translations are loaded from backend', async ({ request }) => {
    test.skip(!apiAvailable, 'Servers not running');

    // The app loads its error translations directly from the backend
    // (GET /i18n/errors/:locale). Hit the API directly so the check is
    // env-agnostic — the Nuxt `/api` proxy is disabled under `lt dev`.
    const response = await request.get(`${API_BASE}/i18n/errors/de`);
    expect([200, 304]).toContain(response.status());

    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('errors');
      expect(data.errors).toHaveProperty('LTNS_0010');
      console.info(`  Error translations loaded: ${Object.keys(data.errors).length} codes`);
    }
  });
});
