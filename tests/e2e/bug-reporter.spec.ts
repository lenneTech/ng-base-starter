/**
 * bug.lt outside production, as in the Nuxt template: the floating "Fehler melden" button on every page and the report
 * endpoint `POST /_bug-lt/report` on the SSR server, which files reports in Linear (`ltBugReport()` in `src/server.ts`).
 *
 * The suite runs against a non-production stage (`NG_PUBLIC_APP_ENV=local`/`ci`), where both are on. In production
 * (or without a stage label) both are off: the endpoint answers 404 and the button renders nothing — ng-base's own
 * tests pin that switch (`isLtBugActive`, `isLtBugServerEnabled`).
 *
 * The endpoint is probed with a GET: an active endpoint refuses the method (405) before rate limiting and before it
 * needs Linear credentials, so the probe neither files an issue nor counts against the limit.
 */
import { expect, test } from '@playwright/test';
import { gotoAndWaitForHydration } from '@lenne.tech/ng-base/testing';

import { FRONTEND_BASE } from './helpers/auth-backend';

const STAGE = (process.env['NG_PUBLIC_APP_ENV'] ?? '').trim().toLowerCase();
const ACTIVE = STAGE !== '' && STAGE !== 'production' && STAGE !== 'prod' && process.env['NG_PUBLIC_LT_BUG_ENABLED'] !== 'false';

test.describe('bug.lt reporter', () => {
  test.skip(!ACTIVE, `bug.lt is off on this stage (NG_PUBLIC_APP_ENV=${STAGE || 'unset'})`);

  test('offers the report button once the page is idle', async ({ page }) => {
    await gotoAndWaitForHydration(page, '/');
    await expect(page.getByRole('button', { name: 'Fehler melden' })).toBeVisible({ timeout: 15000 });
  });

  test('mounts the report endpoint on the SSR server', async ({ request }) => {
    const response = await request.get(`${FRONTEND_BASE}/_bug-lt/report`);
    expect(response.status(), 'an active endpoint refuses GET with 405; 404 means it is not mounted or switched off').toBe(405);
  });
});
