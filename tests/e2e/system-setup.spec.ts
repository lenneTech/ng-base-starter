import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';
import { fillInput, generateTestUser, gotoAndWaitForHydration, waitForURLAndHydration } from '@lenne.tech/ng-base/testing';

import { API_BASE } from './helpers/auth-backend';

/**
 * The setup page against a real API, with the HTTP init closed and with it open.
 *
 * Since nest-server 12.4.0, `POST /system-setup/init` is closed outside `local`, `ci` and `e2e`
 * unless `systemSetup.httpInit` opens it, and `GET /system-setup/status` reports it
 * (`httpInitEnabled`). A deployed system without that release must show how to set it up through
 * the configuration instead of a form that fails with 403, must not send its visitors in a loop,
 * and must keep the login reachable. Locally and in E2E the first admin is still created through
 * the form, as before.
 *
 * Both cases need an EMPTY database (no user, so `needsSetup` is true), and the closed one an API
 * started with `NSC__SYSTEM_SETUP__HTTP_INIT=false`. That is why the spec only runs when
 * `E2E_SETUP_CASE` names the case, and fails instead of skipping when the API does not match it:
 *
 *   E2E_SETUP_CASE=closed  API with NSC__SYSTEM_SETUP__HTTP_INIT=false, empty database
 *   E2E_SETUP_CASE=open    API as configured for e2e, empty database; creates the first admin
 *
 * The CI job `e2e-auth` runs `closed`, restarts the API, runs `open` (the admin it creates is the
 * one the rest of the suite runs against), then the full suite, where this spec skips. The token
 * case is pinned in `tests/unit/pages/auth-setup.test.ts`.
 */
const SETUP_CASE = process.env.E2E_SETUP_CASE;

interface SetupStatus {
  httpInitEnabled?: unknown;
  needsSetup?: unknown;
}

/** Every console error, uncaught page error and HTTP error response while the page runs. */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  return problems;
}

test.describe('System setup page', () => {
  test.skip(SETUP_CASE !== 'closed' && SETUP_CASE !== 'open', 'Needs an empty database and E2E_SETUP_CASE=closed|open, see the header');

  test.beforeAll(async ({ request }) => {
    const status = (await (await request.get(`${API_BASE}/system-setup/status`)).json()) as SetupStatus;
    expect(status.needsSetup, 'E2E_SETUP_CASE needs a database without users').toBe(true);
    expect(typeof status.httpInitEnabled, 'GET /system-setup/status has no httpInitEnabled: the API predates nest-server 12.4.0').toBe('boolean');
    expect(status.httpInitEnabled, `E2E_SETUP_CASE=${SETUP_CASE} needs an API with the HTTP init ${SETUP_CASE}`).toBe(SETUP_CASE === 'open');
  });

  test('closed: shows how to set up through the configuration, keeps the login reachable, and logs no errors', async ({ page }) => {
    test.skip(SETUP_CASE !== 'closed', 'Runs with E2E_SETUP_CASE=closed');
    const problems = collectProblems(page);

    await gotoAndWaitForHydration(page, '/auth/setup');
    await expect(page.getByText('NSC__SYSTEM_SETUP__INITIAL_ADMIN__EMAIL')).toBeVisible();
    await expect(page.getByText('NSC__SYSTEM_SETUP__HTTP_INIT__TOKEN')).toBeVisible();
    await expect(page.locator('input[name$=".email"]'), 'no form while the HTTP init is closed').toHaveCount(0);

    // Phone width, or 400 % zoom (WCAG 1.4.10): the names have to fit. A name wider than the card
    // pushed its start left of the screen, where nothing scrolls, and an operator copied a variable
    // the API never reads.
    const viewport = page.viewportSize();
    await page.setViewportSize({ height: 640, width: 320 });
    for (const code of await page.locator('main code').all()) {
      const name = (await code.textContent()) ?? '';
      const box = await code.boundingBox();
      expect(box, name).not.toBeNull();
      expect(box?.x ?? -1, `${name} starts left of the screen`).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? Number.POSITIVE_INFINITY), `${name} ends right of the screen`).toBeLessThanOrEqual(320);
    }
    if (viewport) {
      await page.setViewportSize(viewport);
    }

    await page.getByRole('link', { name: 'Zur Anmeldung' }).click();
    await waitForURLAndHydration(page, /\/auth\/login$/);
    await expect(page.locator('input[name$=".email"]')).toBeVisible();

    // A visit of its own stays on the login as well: the setup middleware does not send it back.
    await gotoAndWaitForHydration(page, '/auth/login');
    expect(new URL(page.url()).pathname).toBe('/auth/login');

    expect(problems).toEqual([]);
  });

  test('open: sends the visitor to the form and creates the first admin through it', async ({ page, request }) => {
    test.skip(SETUP_CASE !== 'open', 'Runs with E2E_SETUP_CASE=open');
    const admin = generateTestUser('setup-admin');

    await gotoAndWaitForHydration(page, '/');
    await waitForURLAndHydration(page, /\/auth\/setup$/);
    await expect(page.locator('input[name$=".token"]'), 'no token field while the API asks for none').toHaveCount(0);

    await fillInput(page, 'input[name$=".name"]', admin.name);
    await fillInput(page, 'input[name$=".email"]', admin.email);
    await fillInput(page, 'input[name$=".password"]', admin.password);
    await fillInput(page, 'input[name$=".confirmPassword"]', admin.password);
    await page.getByRole('button', { name: 'System einrichten' }).click();

    await waitForURLAndHydration(page, /\/auth\/login$/);
    const status = (await (await request.get(`${API_BASE}/system-setup/status`)).json()) as SetupStatus;
    expect(status.needsSetup, 'the admin exists now').toBe(false);

    // Set up, the setup page sends to the login.
    await gotoAndWaitForHydration(page, '/auth/setup');
    await waitForURLAndHydration(page, /\/auth\/login$/);
  });
});
