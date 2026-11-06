/**
 * The AI pages appear only while the API runs its AI module, against a real API.
 *
 * nest-server-starter leaves the module off by default (decided 2026-11-04). nest-server 12.3.1
 * answers the public `GET /ai/status` with 200 `{ mcp }` while it runs and with 404 while it is off;
 * `useLtAiStatus()` reads it, the layout shows the AI links accordingly, and `ai.global.ts` sends an
 * AI route to /app while the module is off. The spec checks the state the API is in: the `e2e-auth`
 * CI jobs switch the module on, an lt-monorepo's `app:test` runs it off. A run that sets
 * `NSC__AI__ENCRYPTION_SECRET` expects it on, so a lost variable shows up as red rather than as the
 * off branch passing. Route matching and the redirect are pinned by `tests/unit/middleware/ai-global.test.ts`.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fillInput, generateTestUser, gotoAndWaitForHydration, waitForURLAndHydration } from '@lenne.tech/ng-base/testing';

import { API_BASE, DEFAULT_FEATURES, FRONTEND_BASE, parseFeatures, resetTestData, waitForVerificationToken, type Features } from './helpers/auth-backend';

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

// =============================================================================
// Tests
// =============================================================================

let ready = false;
let aiEnabled = false;
let features: Features = { ...DEFAULT_FEATURES };

test.beforeAll(async ({ request }) => {
  try {
    ready = (await request.get(`${API_BASE}/`)).ok() && (await request.get(`${FRONTEND_BASE}/`)).ok();
  } catch {
    ready = false;
  }
  if (!ready) {
    console.error(`AI visibility E2E needs the API (${API_BASE}) and the app (${FRONTEND_BASE}) running — see docs/e2e-auth.md`);
    return;
  }

  const featuresResponse = await request.get(`${API_BASE}/iam/features`);
  expect(featuresResponse.ok(), `GET ${API_BASE}/iam/features failed with ${featuresResponse.status()}`).toBeTruthy();
  features = parseFeatures(await featuresResponse.json());

  aiEnabled = (await request.get(`${API_BASE}/ai/status`)).ok();
});

// The AI links are for signed-in users. An anonymous visitor needs no status, and with the module
// off (the default) the request answers 404, which the browser logs on every visit to the landing
// page. Independent of the API's state.
test('anonymous visitors cause no AI status request', async ({ page }) => {
  test.skip(!ready, 'Servers not running');
  const statusRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/ai/status')) statusRequests.push(request.url());
  });

  await gotoAndWaitForHydration(page, '/');
  await page.waitForLoadState('networkidle');

  expect(statusRequests).toEqual([]);
});

test.describe('AI pages follow the API AI module', () => {
  const user = generateTestUser('ai-visibility');

  test.afterAll(async () => {
    try {
      await resetTestData(user.email);
    } catch (error) {
      console.error(`  Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  test('the AI links and routes exist exactly while the module runs', async ({ page }) => {
    test.skip(!ready, 'Servers not running');
    if (process.env.NSC__AI__ENCRYPTION_SECRET) {
      expect(
        aiEnabled,
        `GET ${API_BASE}/ai/status does not answer 200 although this run sets NSC__AI__ENCRYPTION_SECRET: the API did not get it, or runs below nest-server 12.3.1`,
      ).toBe(true);
    }

    await resetTestData(user.email);
    await registerUser(page, user, features);
    await gotoAndWaitForHydration(page, '/app');
    const aiLink = page.getByRole('link', { name: 'KI-Assistent' });

    if (aiEnabled) {
      await test.step('module on: the links show and the routes open', async () => {
        await expect(aiLink).toBeVisible({ timeout: 10000 });
        await gotoAndWaitForHydration(page, '/app/settings/ai');
        await expect(page).toHaveURL(/\/app\/settings\/ai$/);
        await expect(page.getByRole('heading', { name: 'KI-Einstellungen' })).toBeVisible({ timeout: 10000 });
      });
    } else {
      await test.step('module off: no links, and an AI route goes to /app', async () => {
        // The signed-in header has rendered, so a missing link is an answer, not a race.
        await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 10000 });
        await expect(aiLink).toHaveCount(0);
        await gotoAndWaitForHydration(page, '/app/settings/ai');
        await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10000 });
      });
    }
  });
});
