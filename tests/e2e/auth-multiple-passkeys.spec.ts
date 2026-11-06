/**
 * Several passkeys for one account (DEV-1368).
 *
 * The report: a second passkey could only be added through 1Password, never through the iCloud
 * keychain. That is WebAuthn, not a defect. Registration sends the account's existing credentials
 * as `excludeCredentials`, and an authenticator that already holds one of them refuses with
 * `InvalidStateError`; useLtAuth().registerPasskey turns that into a German message and stores
 * nothing. A different authenticator (another device, 1Password) holds none of them and adds its
 * own. This spec proves both halves and that each passkey then signs in on its own.
 *
 * Two CDP virtual authenticators stand in for the two devices. Only one is attached at a time:
 * with two, Chrome decides which one answers, and the spec would test that choice instead.
 * Credentials live only in the CDP session that created them, so the whole flow is one test on
 * one page. Prerequisites and backend scenarios: see `docs/e2e-auth.md`.
 */

import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { fillInput, generateTestUser, gotoAndWaitForHydration, waitForHydration, waitForURLAndHydration } from '@lenne.tech/ng-base/testing';

import { API_BASE, DEFAULT_FEATURES, FRONTEND_BASE, parseFeatures, resetTestData, waitForVerificationToken, type Features } from './helpers/auth-backend';

/** The start of the message useLtAuth().registerPasskey shows for `InvalidStateError`. */
const PASSKEY_ALREADY_REGISTERED = 'Du hast bereits einen Passkey für diese Website registriert.';

// =============================================================================
// UI Helpers
// =============================================================================

async function loginWithEmail(page: Page, email: string, password: string): Promise<void> {
  await gotoAndWaitForHydration(page, '/auth/login');
  await page.locator('input[name$=".email"]').waitFor({ state: 'visible', timeout: 10000 });
  await fillInput(page, 'input[name$=".email"]', email);
  await fillInput(page, 'input[name$=".password"]', password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
}

/** Register through the UI and end signed in on /app, whatever the backend scenario. */
async function registerUser(page: Page, user: { email: string; name: string; password: string }, features: Features): Promise<void> {
  await gotoAndWaitForHydration(page, '/auth/register');
  await page.locator('input[name$=".name"]').waitFor({ state: 'visible', timeout: 10000 });
  await fillInput(page, 'input[name$=".name"]', user.name);
  await fillInput(page, 'input[name$=".email"]', user.email);
  await fillInput(page, 'input[name$=".password"]', user.password);
  await fillInput(page, 'input[name$=".confirmPassword"]', user.password);

  if (features.signUpChecks) {
    const termsCheckbox = page.getByRole('checkbox', { name: /akzeptiere die AGB/i });
    await termsCheckbox.waitFor({ state: 'visible', timeout: 5000 });
    await termsCheckbox.click();
    await expect(termsCheckbox).toBeChecked();
  }

  await page.getByRole('button', { name: 'Konto erstellen' }).click();

  if (features.emailVerification) {
    await waitForURLAndHydration(page, /\/auth\/verify-email/, { timeout: 15000 });
    const token = await waitForVerificationToken(user.email);
    expect(token, 'Verification token not found in server logs').not.toBeNull();
    await gotoAndWaitForHydration(page, `/auth/verify-email?token=${token}`);
    await expect(page.getByRole('heading', { name: 'E-Mail bestätigt' })).toBeVisible({ timeout: 15000 });
    await loginWithEmail(page, user.email, user.password);
  } else {
    const laterButton = page.getByRole('button', { name: 'Später einrichten' });
    await laterButton.waitFor({ state: 'visible', timeout: 10000 });
    await laterButton.click();
  }
  await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
}

async function logout(page: Page): Promise<void> {
  const logoutButton = page.getByLabel('Logout');
  await logoutButton.waitFor({ state: 'visible', timeout: 5000 });
  await logoutButton.click();
  await page.waitForURL(/\/auth\/login/, { timeout: 5000 });
  await waitForHydration(page);
}

async function loginWithPasskey(page: Page, email: string): Promise<void> {
  await gotoAndWaitForHydration(page, '/auth/login');
  await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
  await waitForURLAndHydration(page, /\/app/, { timeout: 15000 });
  await expect(page.getByText(email).first()).toBeVisible({ timeout: 5000 });
}

/** Freshly loaded security page, so the list shows what the server stored. */
async function openSecuritySettings(page: Page): Promise<void> {
  await gotoAndWaitForHydration(page, '/app/settings/security');
  await page.getByRole('button', { name: 'Passkey hinzufügen' }).waitFor({ state: 'visible', timeout: 10000 });
}

async function addPasskey(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Passkey hinzufügen' }).click();
  await page.getByPlaceholder('Name für den Passkey').fill(name);
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
}

/** One row per stored passkey: the list renders a delete button for each. */
function passkeyRows(page: Page) {
  return page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Löschen' }) });
}

/** Attach one virtual platform authenticator (Touch ID, iCloud keychain, 1Password alike). */
async function attachAuthenticator(cdpSession: CDPSession): Promise<string> {
  const { authenticatorId } = await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  return authenticatorId;
}

// =============================================================================
// Tests
// =============================================================================

let ready = false;
let features: Features = { ...DEFAULT_FEATURES };

test.beforeAll(async ({ request }) => {
  try {
    ready = (await request.get(`${API_BASE}/`)).ok() && (await request.get(`${FRONTEND_BASE}/`)).ok();
  } catch {
    ready = false;
  }
  if (!ready) {
    console.error(`Multiple-passkey E2E needs the API (${API_BASE}) and the app (${FRONTEND_BASE}) running — see docs/e2e-auth.md`);
    return;
  }

  const featuresResponse = await request.get(`${API_BASE}/iam/features`);
  expect(featuresResponse.ok(), `GET ${API_BASE}/iam/features failed with ${featuresResponse.status()}`).toBeTruthy();
  features = parseFeatures(await featuresResponse.json());
});

test.describe('Several passkeys per account (DEV-1368)', () => {
  const user = generateTestUser('passkeys');

  test.afterAll(async () => {
    try {
      await resetTestData(user.email);
    } catch (error) {
      console.error(`  Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  test('one authenticator refuses a second passkey, another adds its own, and each signs in', async ({ context, page }) => {
    test.skip(!ready, 'Servers not running');
    test.skip(!features.passkey, 'Passkeys disabled in the current config');
    // Registration, three passkey ceremonies and three sign-ins in one test.
    test.slow();

    await resetTestData(user.email);
    await registerUser(page, user, features);

    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('WebAuthn.enable');
    let authenticatorId = await attachAuthenticator(cdpSession);

    try {
      await test.step('authenticator A adds "MacBook"', async () => {
        await openSecuritySettings(page);
        await addPasskey(page, 'MacBook');
        await expect(page.getByText('MacBook', { exact: true })).toBeVisible({ timeout: 15000 });
        await expect(passkeyRows(page)).toHaveCount(1);
      });

      await test.step('A refuses a second passkey for the same account, and nothing is stored', async () => {
        await addPasskey(page, 'MacBook 2');
        // The toast text also sits in a hidden screen-reader announcer, so only the visible copy counts.
        await expect(page.getByText(PASSKEY_ALREADY_REGISTERED).filter({ visible: true }).first()).toBeVisible({ timeout: 15000 });

        await openSecuritySettings(page);
        await expect(passkeyRows(page)).toHaveCount(1);
        await expect(page.getByText('MacBook 2')).toHaveCount(0);
      });

      // A's credential is kept to put A back for the last sign-in.
      const { credentials } = await cdpSession.send('WebAuthn.getCredentials', { authenticatorId });
      expect(credentials, 'authenticator A should hold exactly the one passkey it created').toHaveLength(1);
      const credentialA = credentials[0]!;

      await test.step('authenticator B (another device, 1Password) adds "iPhone"', async () => {
        await cdpSession.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
        authenticatorId = await attachAuthenticator(cdpSession);

        await addPasskey(page, 'iPhone');
        await expect(page.getByText('iPhone', { exact: true })).toBeVisible({ timeout: 15000 });

        await openSecuritySettings(page);
        await expect(passkeyRows(page)).toHaveCount(2);
        await expect(page.getByText('MacBook', { exact: true })).toBeVisible();
        await expect(page.getByText('iPhone', { exact: true })).toBeVisible();
      });

      await test.step('B signs in with its passkey', async () => {
        await logout(page);
        await loginWithPasskey(page, user.email);
      });

      await test.step('A signs in with its passkey', async () => {
        await cdpSession.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
        authenticatorId = await attachAuthenticator(cdpSession);
        await cdpSession.send('WebAuthn.addCredential', { authenticatorId, credential: credentialA });

        await logout(page);
        await loginWithPasskey(page, user.email);
      });
    } finally {
      try {
        await cdpSession.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
        await cdpSession.send('WebAuthn.disable');
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});
