/**
 * The MCP confirmation switch on /app/settings/ai, against a real API (DEV-2653).
 *
 * Switched off, an MCP client runs destructive tools in the user's name without asking, so the
 * one thing that must hold is that the page shows what the server stores: the choice lands in
 * `GET /ai/settings` and is still there after a reload. The page states in between (warning,
 * locked switch, refused change) are pinned by `tests/unit/pages/settings-ai-mcp-confirmation.test.ts`.
 *
 * Needs nest-server 12.3.1 or later with its AI module and its MCP server switched on: the page
 * offers the switch only while `GET /ai/status` reports `mcp: true`. The starter API leaves both
 * off (no `ai` block in `config.env.ts`); `NSC__AI__ENCRYPTION_SECRET` and
 * `NSC__AI__MCP__ENABLED=true` switch them on, as the `e2e-auth` CI jobs do. The spec skips without
 * MCP, unless the run itself sets `NSC__AI__MCP__ENABLED`: then a missing MCP means the job lost its
 * configuration or the API is older, and a skip would hide it. Not `process.env.CI`: an
 * lt-monorepo's `app:test` runs this suite with `CI=true` against an API whose module is off by
 * default, and must not go red for it. See `docs/e2e-auth.md`.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fillInput, generateTestUser, gotoAndWaitForHydration, waitForHydration, waitForURLAndHydration } from '@lenne.tech/ng-base/testing';

import { API_BASE, DEFAULT_FEATURES, FRONTEND_BASE, parseFeatures, resetTestData, waitForVerificationToken, type Features } from './helpers/auth-backend';

const SWITCH_LABEL = 'Vor destruktiven Aktionen nachfragen';
const WARNING = 'Destruktive Aktionen werden über MCP ohne Rückfrage ausgeführt.';

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

/**
 * What the server stores for the signed-in user, read with the browser's own session: its session cookie in cookie
 * mode, its JWT as bearer header in JWT mode (no session cookie there; the app keeps the JWT in `<prefix>-jwt-token`).
 */
async function storedSettings(page: Page): Promise<{ mcpConfirmation: boolean; mcpConfirmationEnforced: boolean }> {
  const jwtCookie = (await page.context().cookies()).find((cookie) => cookie.name.endsWith('-jwt-token'));
  // ng-base writes the token raw (from 22.0.1; 22.0.0 wrote it JSON-quoted), URL-encoded as every cookie value.
  const jwt = jwtCookie ? decodeURIComponent(jwtCookie.value) : '';
  const response = await page.request.get(`${API_BASE}/ai/settings`, jwt ? { headers: { authorization: `Bearer ${jwt}` } } : {});
  expect(response.ok(), `GET ${API_BASE}/ai/settings failed with ${response.status()}`).toBeTruthy();
  return response.json();
}

/** The switch, once the settings have loaded (it stays disabled until then). */
async function mcpSwitch(page: Page) {
  const toggle = page.getByRole('switch', { name: SWITCH_LABEL });
  await expect(toggle).toBeEnabled({ timeout: 10000 });
  return toggle;
}

// =============================================================================
// Tests
// =============================================================================

let ready = false;
let mcpAvailable = false;
let features: Features = { ...DEFAULT_FEATURES };

test.beforeAll(async ({ request }) => {
  try {
    ready = (await request.get(`${API_BASE}/`)).ok() && (await request.get(`${FRONTEND_BASE}/`)).ok();
  } catch {
    ready = false;
  }
  if (!ready) {
    console.error(`MCP confirmation E2E needs the API (${API_BASE}) and the app (${FRONTEND_BASE}) running — see docs/e2e-auth.md`);
    return;
  }

  const featuresResponse = await request.get(`${API_BASE}/iam/features`);
  expect(featuresResponse.ok(), `GET ${API_BASE}/iam/features failed with ${featuresResponse.status()}`).toBeTruthy();
  features = parseFeatures(await featuresResponse.json());

  // Public: 200 `{ mcp }` while the AI module runs, 404 while it is off or nest-server predates 12.3.1.
  const status = await request.get(`${API_BASE}/ai/status`);
  mcpAvailable = status.ok() && (await status.json())?.mcp === true;
});

test.describe('MCP confirmation switch (DEV-2653)', () => {
  const user = generateTestUser('mcp-confirmation');

  test.afterAll(async () => {
    try {
      await resetTestData(user.email);
    } catch (error) {
      console.error(`  Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  test('switching the question off is stored, survives a reload, and switches back on', async ({ page }) => {
    test.skip(!ready, 'Servers not running');
    if (process.env.NSC__AI__MCP__ENABLED) {
      expect(
        mcpAvailable,
        `GET ${API_BASE}/ai/status reports no MCP server although this run sets NSC__AI__MCP__ENABLED: the API did not get it, or runs below nest-server 12.3.1`,
      ).toBe(true);
    }
    test.skip(!mcpAvailable, 'No MCP server in the API (set NSC__AI__ENCRYPTION_SECRET and NSC__AI__MCP__ENABLED=true), or nest-server below 12.3.1');

    await resetTestData(user.email);
    await registerUser(page, user, features);

    await test.step('a new user starts with the question on', async () => {
      await gotoAndWaitForHydration(page, '/app/settings/ai');
      await expect(await mcpSwitch(page)).toBeChecked();
      await expect(page.getByText(WARNING)).toHaveCount(0);
      expect(await storedSettings(page)).toEqual({ mcpConfirmation: true, mcpConfirmationEnforced: false });
    });

    await test.step('switching off is stored and warned about', async () => {
      const toggle = await mcpSwitch(page);
      await toggle.click();
      await expect(toggle).not.toBeChecked({ timeout: 10000 });
      await expect(page.getByText(WARNING)).toBeVisible();
      expect(await storedSettings(page)).toMatchObject({ mcpConfirmation: false });
    });

    await test.step('the choice survives a reload', async () => {
      await page.reload();
      await waitForHydration(page);
      await expect(await mcpSwitch(page)).not.toBeChecked();
      await expect(page.getByText(WARNING)).toBeVisible();
    });

    await test.step('switching back on is stored and drops the warning', async () => {
      const toggle = await mcpSwitch(page);
      await toggle.click();
      await expect(toggle).toBeChecked({ timeout: 10000 });
      await expect(page.getByText(WARNING)).toHaveCount(0);
      expect(await storedSettings(page)).toMatchObject({ mcpConfirmation: true });
    });
  });
});
