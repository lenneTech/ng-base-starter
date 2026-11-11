/**
 * Auth E2E — prerequisites, the four backend configuration scenarios and how to run them all:
 * see `docs/e2e-auth.md`. The suite detects the live configuration via GET /iam/features and
 * skips whatever does not apply.
 */

import { expect, test } from '@playwright/test';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { extractTOTPSecret, fillInput, generateTestUser, generateTOTP, gotoAndWaitForHydration, waitForHydration, waitForURLAndHydration } from '@lenne.tech/ng-base/testing';

import {
  API_BASE,
  DEFAULT_FEATURES,
  FRONTEND_BASE,
  parseFeatures,
  resetTestData,
  waitForPasswordResetToken,
  waitForVerificationToken,
  type Features,
} from './helpers/auth-backend';

// =============================================================================
// UI Helpers
// =============================================================================

async function loginWithEmail(page: Page, email: string, password: string, loginPath = '/auth/login'): Promise<void> {
  await gotoAndWaitForHydration(page, loginPath);
  await page.locator('input[name$=".email"]').waitFor({ state: 'visible', timeout: 10000 });
  await fillInput(page, 'input[name$=".email"]', email);
  await fillInput(page, 'input[name$=".password"]', password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
}

/**
 * The auth mode the app adopted (`authMode` in its `<prefix>-auth-state` cookie), checked against `E2E_EXPECT_AUTH_MODE`
 * (`cookie` | `jwt`), which `.github/workflows/test.yml` sets per API start. `GET /iam/features` cannot tell the modes apart: its `jwt` reports
 * the JWT plugin, which is on in both. Without the variable nothing is asserted.
 */
async function expectAuthMode(page: Page): Promise<void> {
  const expected = process.env['E2E_EXPECT_AUTH_MODE'];
  if (!expected) {
    return;
  }
  const state = (await page.context().cookies()).find((cookie) => cookie.name.endsWith('-auth-state'));
  expect(state, 'the auth-state cookie after sign-in').toBeDefined();
  const { authMode } = JSON.parse(decodeURIComponent(state?.value ?? '{}')) as { authMode?: string };
  expect(authMode, 'the auth mode the app adopted').toBe(expected);
}

async function loginWith2FA(page: Page, email: string, password: string, totpSecret: string): Promise<void> {
  await loginWithEmail(page, email, password);
  await waitForURLAndHydration(page, /\/auth\/2fa/, { timeout: 10000 });

  const totpCode = generateTOTP(totpSecret);
  await page.locator('input').fill(totpCode);
  await page.getByRole('button', { name: /verifizieren|bestätigen/i }).click();
  await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
}

async function logout(page: Page): Promise<void> {
  const logoutButton = page.getByLabel('Abmelden', { exact: true });
  await logoutButton.waitFor({ state: 'visible', timeout: 5000 });
  await logoutButton.click();
  await page.waitForURL(/\/auth\/login/, { timeout: 5000 });
  await waitForHydration(page);
}

async function setupVirtualAuthenticator(context: BrowserContext, page: Page) {
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
  return { cdpSession, authenticatorId };
}

async function cleanupAuthenticator(cdpSession: CDPSession, authenticatorId: string): Promise<void> {
  try {
    await cdpSession.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdpSession.send('WebAuthn.disable');
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * The banner of the run. The auth mode comes from `E2E_EXPECT_AUTH_MODE`, not from `features.jwt`: that flag reports
 * the JWT plugin, which nest-server runs in cookie mode too, so it cannot tell scenario 1 from 3.
 */
function getConfigScenarioName(features: Features): string {
  const mode = process.env['E2E_EXPECT_AUTH_MODE'];
  const all = features.emailVerification && features.signUpChecks;
  const none = !features.emailVerification && !features.signUpChecks;
  if (mode === 'cookie' && all) return 'Szenario 1: Zero Config (alles aktiviert, Cookies)';
  if (mode === 'cookie' && none) return 'Szenario 2: Cookies, ohne EmailVerification/SignUpChecks';
  if (mode === 'jwt' && all) return 'Szenario 3: JWT, alles aktiviert';
  if (mode === 'jwt' && none) return 'Szenario 4: JWT, ohne EmailVerification/SignUpChecks';
  return `Modus ${mode ?? 'unbekannt (E2E_EXPECT_AUTH_MODE fehlt)'}, emailVerification=${features.emailVerification}, signUpChecks=${features.signUpChecks}`;
}

// =============================================================================
// Tests
// =============================================================================

let apiAvailable = false;
let features: Features | null = null;

test.beforeAll(async ({ request }) => {
  // Check API and Frontend availability
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
    console.error('╔══════════════════════════════════════════════════════════════════╗');
    console.error('║  COMPREHENSIVE E2E TESTS REQUIRE RUNNING SERVERS                ║');
    console.error('╠══════════════════════════════════════════════════════════════════╣');
    console.error(`║  ${apiAvailable ? '✓' : '✗'} API Server (localhost:3000) - ${apiAvailable ? 'Running' : 'NOT RUNNING'}                   ║`);
    console.error(`║  ${frontendAvailable ? '✓' : '✗'} Frontend (localhost:3001) - ${frontendAvailable ? 'Running' : 'NOT RUNNING'}                    ║`);
    console.error('╠══════════════════════════════════════════════════════════════════╣');
    console.error('║  Start servers:                                                  ║');
    console.error('║  API: cd nest-server-starter && npm run start:local              ║');
    console.error('║  APP: cd nuxt-base-template && npm run dev                       ║');
    console.error('╚══════════════════════════════════════════════════════════════════╝');
    apiAvailable = false;
    return;
  }

  apiAvailable = true;

  // Fetch features to detect configuration
  try {
    const featuresResponse = await request.get(`${API_BASE}/iam/features`);
    expect(featuresResponse.ok(), `GET ${API_BASE}/iam/features failed with ${featuresResponse.status()}`).toBeTruthy();
    features = parseFeatures(await featuresResponse.json());
  } catch {
    console.error('Could not fetch /iam/features - assuming zero config (defaults)');
    features = { ...DEFAULT_FEATURES };
  }

  // Print configuration banner
  console.info('');
  console.info('╔══════════════════════════════════════════════════════════════════╗');
  console.info('║  BETTER-AUTH E2E TEST CONFIGURATION                             ║');
  console.info('╠══════════════════════════════════════════════════════════════════╣');
  console.info(`║  ${getConfigScenarioName(features).padEnd(62)}║`);
  console.info('╠══════════════════════════════════════════════════════════════════╣');
  console.info(`║  JWT Mode:            ${String(features.jwt).padEnd(40)}║`);
  console.info(`║  Email Verification:  ${String(features.emailVerification).padEnd(40)}║`);
  console.info(`║  Sign-Up Checks:      ${String(features.signUpChecks).padEnd(40)}║`);
  console.info(`║  Two-Factor:          ${String(features.twoFactor).padEnd(40)}║`);
  console.info(`║  Passkey:             ${String(features.passkey).padEnd(40)}║`);
  console.info('╚══════════════════════════════════════════════════════════════════╝');
  console.info('');
});

// =============================================================================
// Comprehensive Better-Auth Flow
// =============================================================================

test.describe.serial('Comprehensive Better-Auth E2E Flow', () => {
  const testUser = generateTestUser('comprehensive');
  let totpSecret: string | null = null;

  // =========================================================================
  // Step 0: Full Reset
  // =========================================================================

  test('Step 0: Full Reset (Database + Browser)', async ({ page }) => {
    test.skip(!apiAvailable, 'Servers not running');

    // Reset database for this test user
    await resetTestData(testUser.email);

    // Clear browser state
    await page.context().clearCookies();

    console.info(`  Test user: ${testUser.email}`);
    console.info(`  Database reset complete`);
  });

  // =========================================================================
  // Step 1: Registration
  // =========================================================================

  test('Step 1: Register new user', async ({ page }) => {
    test.skip(!apiAvailable, 'Servers not running');

    await gotoAndWaitForHydration(page, '/auth/register');
    await page.locator('input[name$=".name"]').waitFor({ state: 'visible', timeout: 10000 });

    // Fill registration form
    await fillInput(page, 'input[name$=".name"]', testUser.name);
    await fillInput(page, 'input[name$=".email"]', testUser.email);
    await fillInput(page, 'input[name$=".password"]', testUser.password);
    await fillInput(page, 'input[name$=".confirmPassword"]', testUser.password);

    // Accept terms if signUpChecks is enabled
    if (features?.signUpChecks) {
      // Spartan's checkbox is a button[role=checkbox] named by its label. Click, then wait for the state: Angular
      // renders it on the next change detection, which Playwright's check() does not wait for.
      const termsCheckbox = page.getByRole('checkbox', { name: /akzeptiere die AGB/i });
      await termsCheckbox.waitFor({ state: 'visible', timeout: 5000 });
      await termsCheckbox.click();
      await expect(termsCheckbox).toBeChecked();
      console.info('  Terms checkbox checked (signUpChecks enabled)');
    }

    // Submit form
    await page.getByRole('button', { name: 'Konto erstellen' }).click();

    if (features?.emailVerification) {
      // Should redirect to verify-email page
      await waitForURLAndHydration(page, /\/auth\/verify-email/, { timeout: 15000 });
      await expect(page.getByText('E-Mail bestätigen')).toBeVisible({ timeout: 5000 });
      console.info('  Redirected to email verification (emailVerification enabled)');
    } else {
      // Should show passkey prompt, skip it
      const laterButton = page.getByRole('button', { name: 'Später einrichten' });
      await laterButton.waitFor({ state: 'visible', timeout: 10000 });
      await laterButton.click();

      await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
      console.info('  Registered and logged in (no email verification)');
    }

    console.info(`  Registered: ${testUser.email}`);
  });

  // =========================================================================
  // Step 2: Email Verification (conditional)
  // =========================================================================

  test('Step 2: Verify email address', async ({ page }) => {
    test.skip(!apiAvailable, 'Servers not running');
    test.skip(!features?.emailVerification, 'Email verification disabled in current config');

    // Fetch verification token from backend server logs
    // The nest-server logs: [EMAIL VERIFICATION] User: <email>, URL: ...?token=<jwt>
    const token = await waitForVerificationToken(testUser.email);
    expect(token, 'Verification token not found in server logs. Ensure backend logs to /tmp/nest-server.log or set NEST_SERVER_LOG').not.toBeNull();

    // Navigate to verify-email with token
    await gotoAndWaitForHydration(page, `/auth/verify-email?token=${token}`);

    // Wait for verification success (use heading to avoid ambiguity with toast notification)
    await expect(page.getByRole('heading', { name: 'E-Mail bestätigt' })).toBeVisible({ timeout: 15000 });
    console.info('  Email verified successfully');

    // Click "Jetzt anmelden" to go to login
    await page.getByRole('link', { name: 'Jetzt anmelden' }).click();
    await waitForURLAndHydration(page, /\/auth\/login/, { timeout: 10000 });
    console.info('  Redirected to login page');
  });

  // =========================================================================
  // Step 3: Passkey Activation + Login via Passkey
  // =========================================================================

  test('Step 3: Activate Passkey and login via Passkey', async ({ page, context }) => {
    test.skip(!apiAvailable, 'Servers not running');

    // Login with email/password first
    await loginWithEmail(page, testUser.email, testUser.password);

    // Handle passkey prompt after login (if coming from registration without email verification)
    // or direct to /app
    try {
      await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
    } catch {
      // May still be on passkey prompt
      const laterButton = page.getByRole('button', { name: 'Später einrichten' });
      if (await laterButton.isVisible()) {
        await laterButton.click();
        await waitForURLAndHydration(page, /\/app/, { timeout: 10000 });
      }
    }

    // Setup virtual authenticator
    const { cdpSession, authenticatorId } = await setupVirtualAuthenticator(context, page);

    try {
      // Navigate to security settings
      await gotoAndWaitForHydration(page, '/app/settings/security');

      // Add passkey
      await page.getByRole('button', { name: 'Passkey hinzufügen' }).click();
      await page.getByPlaceholder('Name für den Passkey').fill('E2E-Fingerprint');
      await page.getByRole('button', { name: 'Hinzufügen' }).click();

      // Verify passkey appears in list
      await expect(page.getByText('E2E-Fingerprint')).toBeVisible({ timeout: 15000 });
      console.info('  Passkey "E2E-Fingerprint" registered');

      // Logout
      await logout(page);
      console.info('  Logged out');

      // Login with passkey
      await gotoAndWaitForHydration(page, '/auth/login');
      await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
      await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
      console.info('  Logged in via Passkey');

      // Logout for next test
      await logout(page);
    } finally {
      await cleanupAuthenticator(cdpSession, authenticatorId);
    }
  });

  // =========================================================================
  // Step 4: 2FA Activation
  // =========================================================================

  test('Step 4: Activate 2FA', async ({ page }) => {
    test.skip(!apiAvailable, 'Servers not running');

    // Login with email/password
    await loginWithEmail(page, testUser.email, testUser.password);
    await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });

    // Navigate to security settings
    await gotoAndWaitForHydration(page, '/app/settings/security');

    // Wait for 2FA section
    const enableButton = page.getByRole('button', { name: '2FA aktivieren' });
    await enableButton.waitFor({ state: 'visible', timeout: 10000 });

    // Fill password
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.click();
    await page.keyboard.type(testUser.password, { delay: 5 });

    // Intercept the 2FA enable response to extract TOTP URI
    const responsePromise = page.waitForResponse((resp) => resp.url().includes('/two-factor/enable') && resp.status() === 200);

    // Click enable button
    await enableButton.click();

    // Extract TOTP secret from API response
    const response = await responsePromise;
    const responseBody = await response.json();
    const totpUri = responseBody.totpURI || responseBody.data?.totpURI;
    expect(totpUri, '2FA enable response should contain totpURI').toBeTruthy();

    const secret = extractTOTPSecret(totpUri);
    expect(secret, 'TOTP secret should be extractable from URI').not.toBeNull();
    totpSecret = secret;

    // Wait for QR code SVG to render
    await page.locator('.bg-white svg').waitFor({ state: 'visible', timeout: 10000 });

    // Generate and enter TOTP code
    const totpCode = generateTOTP(secret!);
    await fillInput(page, 'input[placeholder="000000"]', totpCode);
    await page.getByRole('button', { name: 'Verifizieren' }).click();

    // Wait for backup codes modal and dismiss
    await expect(page.getByRole('heading', { name: 'Backup-Codes' })).toBeVisible({ timeout: 10000 });
    // The dialog stays out of the browser's top layer (no `popover` host, `provideLtUiOverlayDefaults()` in the
    // layouts), otherwise the "copied" toast of this very dialog would sit underneath it.
    await expect(page.locator('[popover]').filter({ has: page.getByRole('heading', { name: 'Backup-Codes' }) })).toHaveCount(0);
    // The dialog is named by its title (screen readers announce "Backup-Codes, dialog", not a nameless dialog) ...
    await expect(page.getByRole('dialog', { name: 'Backup-Codes' })).toBeVisible();
    await page.keyboard.press('Escape');
    // ... and on close focus lands on the 2FA section, not on <body> (the "Verifizieren" button is gone by then).
    await expect(page.locator('#two-factor-title')).toBeFocused();

    // Verify 2FA is now active
    await expect(page.getByText('2FA ist aktiviert')).toBeVisible({ timeout: 5000 });
    console.info('  2FA activated, TOTP secret stored');

    // Logout
    await logout(page);
  });

  // =========================================================================
  // Step 5: Login with 2FA
  // =========================================================================

  test('Step 5: Login with 2FA', async ({ page }) => {
    test.skip(!apiAvailable, 'Servers not running');
    test.skip(!totpSecret, 'TOTP secret not available (2FA activation failed)');

    // Login with email/password from a deep link → 2FA keeps the `redirect` (CLAUDE.md auth rule 6)
    await loginWithEmail(page, testUser.email, testUser.password, '/auth/login?redirect=%2Fapp%2Fsettings%2Fsecurity');
    await waitForURLAndHydration(page, /\/auth\/2fa/, { timeout: 10000 });
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/app/settings/security');

    // Enter TOTP code
    const totpCode = generateTOTP(totpSecret!);
    await page.locator('input').fill(totpCode);
    await page.getByRole('button', { name: /verifizieren|bestätigen/i }).click();

    // Should land on the deep link, not on the dashboard
    await waitForURLAndHydration(page, /\/app\/settings\/security/, { timeout: 15000 });
    await expect(page.getByText(testUser.email).first()).toBeVisible({ timeout: 5000 });
    console.info('  Logged in with 2FA, deep link kept');

    // The JS-readable token cookie holds a JWT or nothing, never the session token (Nuxt template #36). nest-server
    // answers the second factor with `{ token, user }`, and `token` is the session token the httpOnly cookie
    // protects; ng-base adopts only a JWT (`readLtAuthAnswer`, `setJwtToken`), and this pins it end to end.
    const cookies = await page.context().cookies();
    const sessionToken = decodeURIComponent(cookies.find((cookie) => cookie.name.endsWith('session_token'))?.value ?? '').split('.')[0];
    for (const cookie of cookies.filter((candidate) => candidate.name.endsWith('jwt-token'))) {
      expect(cookie.value, `${cookie.name} must hold a JWT, not the session token`).toMatch(/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/);
      expect(cookie.value).not.toBe(sessionToken);
    }

    // Logout
    await logout(page);
  });

  // =========================================================================
  // Step 6: Delete Passkey
  // =========================================================================

  test('Step 6: Delete Passkey, generate new backup codes', async ({ page }) => {
    test.skip(!apiAvailable, 'Servers not running');
    test.skip(!totpSecret, 'TOTP secret not available (2FA required for login)');

    // Login with 2FA
    await loginWith2FA(page, testUser.email, testUser.password, totpSecret!);

    // Navigate to security settings
    await gotoAndWaitForHydration(page, '/app/settings/security');

    // Find and delete the passkey
    await expect(page.getByText('E2E-Fingerprint')).toBeVisible({ timeout: 10000 });

    // Find the passkey row container that has both the name and delete button
    // One list item per passkey: name, creation date and its "Löschen" button.
    const passkeyRow = page.getByRole('listitem').filter({ hasText: 'E2E-Fingerprint' });
    await passkeyRow.getByRole('button', { name: 'Löschen' }).click();

    // Verify passkey is removed
    await expect(page.getByText('E2E-Fingerprint')).not.toBeVisible({ timeout: 10000 });
    console.info('  Passkey "E2E-Fingerprint" deleted');

    // New backup codes, with the password (the Nuxt template's step 6, #50: its dialog's form once had no state, and
    // "Neue Backup-Codes generieren" did nothing, no request and no message).
    await page.getByRole('button', { name: 'Backup-Codes anzeigen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Backup-Codes' });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await fillInput(page, '#backup-codes-password', testUser.password);
    const generated = page.waitForResponse((resp) => resp.url().includes('/two-factor/generate-backup-codes'), { timeout: 15000 });
    await dialog.getByRole('button', { name: 'Neue Backup-Codes generieren' }).click();
    expect((await generated).status(), 'POST /two-factor/generate-backup-codes').toBe(200);
    await expect(dialog.getByRole('list', { name: 'Backup-Codes' }).getByRole('listitem')).toHaveCount(10, { timeout: 10000 });
    await dialog.getByRole('button', { name: 'Schließen' }).last().click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    console.info('  10 new backup codes generated');

    // Logout
    await logout(page);
  });

  // =========================================================================
  // Step 7: Deactivate 2FA
  // =========================================================================

  test('Step 7: Deactivate 2FA', async ({ page }) => {
    test.skip(!apiAvailable, 'Servers not running');
    test.skip(!totpSecret, 'TOTP secret not available (2FA required for login)');

    // Login with 2FA
    await loginWith2FA(page, testUser.email, testUser.password, totpSecret!);

    // Navigate to security settings
    await gotoAndWaitForHydration(page, '/app/settings/security');

    // Verify 2FA is currently active
    await expect(page.getByText('2FA ist aktiviert')).toBeVisible({ timeout: 5000 });

    // Click deactivate button
    await page.getByRole('button', { name: '2FA deaktivieren' }).first().click();

    // Fill password in the deactivation form
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
    await passwordInput.click();
    await page.keyboard.type(testUser.password, { delay: 5 });

    // Click the red deactivate confirmation button
    const confirmButton = page.getByRole('button', { name: '2FA deaktivieren' }).last();
    await confirmButton.click();

    // Verify 2FA is now deactivated
    await expect(page.getByText('2FA ist deaktiviert')).toBeVisible({ timeout: 10000 });
    console.info('  2FA deactivated');

    // Clear TOTP secret since 2FA is disabled
    totpSecret = null;

    // Logout
    await logout(page);
  });

  // =========================================================================
  // Step 8: Login without 2FA
  // =========================================================================

  test('Step 8: Login without 2FA', async ({ page }) => {
    test.skip(!apiAvailable, 'Servers not running');

    // Login with email/password
    await loginWithEmail(page, testUser.email, testUser.password);

    // Should redirect DIRECTLY to /app (no 2FA redirect)
    await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });

    // Verify we are NOT on the 2FA page
    expect(page.url()).not.toContain('/auth/2fa');

    // Verify user is logged in, in the mode the API runs in
    await expect(page.getByText(testUser.email).first()).toBeVisible({ timeout: 5000 });
    await expectAuthMode(page);
    console.info('  Logged in without 2FA - direct to /app');
  });

  test('Step 9: Reset password via the mailed link and sign in with the new one', async ({ page }) => {
    test.skip(!apiAvailable, 'Servers not running');

    // The one half of the reset flow no other layer can see. nest-server covers
    // redeeming a token against the API; auth-password-reset.spec.ts covers the
    // request the app sends. Between them sits the browser path — token out of the
    // query string, form, and whether the new password actually works afterwards —
    // and it was uncovered until this step existed.
    const newPassword = `${testUser.password}-Reset1`;

    // No logout needed, and adding one breaks the step: every test in this file gets
    // a FRESH page, which is why each step starts by signing in again. The visitor
    // here is already a guest, so `guest.global` never fires — and a `logout()` call
    // waits 5s for an "Abmelden" button that is not on a login page.
    await gotoAndWaitForHydration(page, '/auth/forgot-password');
    await fillInput(page, 'input[name$=".email"]', testUser.email);
    await page.getByRole('button', { name: 'Link anfordern' }).click();

    // The token is opaque and the log line masks the address, so it is read per user
    // from the verification document rather than out of the server log.
    const token = await waitForPasswordResetToken(testUser.email);
    expect(token, 'No password-reset token was issued for the test user').not.toBeNull();

    await gotoAndWaitForHydration(page, `/auth/reset-password?token=${token}`);
    await fillInput(page, 'input[name$=".password"]', newPassword);
    await fillInput(page, 'input[name$=".confirmPassword"]', newPassword);
    await page.getByRole('button', { name: 'Passwort speichern' }).click();

    await expect(page.getByRole('heading', { name: 'Passwort zurückgesetzt' })).toBeVisible({ timeout: 15000 });
    console.info('  Password reset accepted');

    // The assertion that carries the step: a success screen proves the request was
    // accepted, not that the credential changed. Only signing in does.
    await loginWithEmail(page, testUser.email, newPassword);
    await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
    await expect(page.getByText(testUser.email).first()).toBeVisible({ timeout: 5000 });
    console.info('  Logged in with the new password');

    // Later steps and the cleanup address this user by password.
    testUser.password = newPassword;
  });

  // =========================================================================
  // Cleanup
  // =========================================================================

  test.afterAll(async () => {
    // Clean up test data from database
    try {
      await resetTestData(testUser.email);
      console.info(`  Cleanup: test user ${testUser.email} removed from database`);
    } catch (error) {
      console.error(`  Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
});
