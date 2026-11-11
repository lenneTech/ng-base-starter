/**
 * The start page carries the project's name and, while there is one, its repository link, both from
 * `src/app/shared/site.ts` (the Nuxt template's `tests/e2e/site-identity.spec.ts`, #44).
 *
 * `lt fullstack init` and `lt frontend angular` set `SITE_NAME` to the project name and `SITE_REPO_URL` to `null`
 * there, and rewrite the `<title>` of `src/index.html`. Without that a generated project showed "Angular Base Starter"
 * in its tab and header and linked to the starter's repository in header, start page and footer. The spec reads both
 * values from the file, so it holds in the starter (a repository link) and in a generated project (none).
 */
import { expect, test } from '@playwright/test';
import { gotoAndWaitForHydration } from '@lenne.tech/ng-base/testing';

import { SITE_NAME, SITE_REPO_URL } from '../../src/app/shared/site';
import { FRONTEND_BASE } from './helpers/auth-backend';

/** The text of an HTML text node: the server escapes `'`, `&`, `<` and `>` in a project name (`Kai&#39;s Shop`). */
function htmlText(raw: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' };
  return raw.replace(/&(?:#x([\da-f]+)|#(\d+)|(amp|apos|gt|lt|quot));/gi, (entity, hex?: string, dec?: string, name?: string) => {
    if (hex) {
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    if (dec) {
      return String.fromCodePoint(Number.parseInt(dec, 10));
    }
    return named[name?.toLowerCase() ?? ''] ?? entity;
  });
}

test.describe('Site name and repository link', () => {
  test('the server html titles the start page with the site name', async ({ request }) => {
    const res = await request.get(`${FRONTEND_BASE}/`, { headers: { 'Accept-Language': 'de' } });
    expect(res.ok()).toBe(true);
    const titles = [...(await res.text()).matchAll(/<title>([^<]*)<\/title>/g)].map((match) => htmlText(match[1] ?? '').trim());
    expect(titles).toEqual([SITE_NAME]);
  });

  test('the header names the site, and the GitHub links follow SITE_REPO_URL', async ({ page }) => {
    await gotoAndWaitForHydration(page, '/');

    await expect(page).toHaveTitle(SITE_NAME);
    await expect(page.locator('header').getByText(SITE_NAME, { exact: true }).first()).toBeVisible();

    if (SITE_REPO_URL) {
      // Header, start page and footer.
      await expect(page.locator(`a[href="${SITE_REPO_URL}"]`)).toHaveCount(3);
    }
    // A generated project has no repository: no link to GitHub at all, the starter's included.
    await expect(page.locator('a[href*="github.com"]')).toHaveCount(SITE_REPO_URL ? 3 : 0);
  });
});
