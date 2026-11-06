// @vitest-environment node
/**
 * Guards the cross-repo Playwright pin, from the side that actually breaks it.
 *
 * `lt-monorepo` pins the Playwright CI image (`mcr.microsoft.com/playwright:vX.Y.Z-noble`)
 * for the `@playwright/test` version that lives HERE. Neither pins the other, and
 * `lt fullstack init` clones whatever is on this repo's main — so bumping the package
 * here silently invalidates the image over there. The generated project then fails
 * `check:playwright-image`, a step with nothing to do with the project itself.
 *
 * That is not hypothetical: it happened for eleven days between 2.18.0 (which raised
 * the package to 1.62.1) and the monorepo catching up. Nobody noticed because the only
 * guard that compares the two — `lt-monorepo/scripts/check-playwright-image.mjs` —
 * cannot run in the repo that owns the pin: its `projects/` is empty by design, so it
 * always takes the skip path.
 *
 * This test closes that direction. The repo whose bump CAUSES the drift is the one
 * that goes red, while the bump is still in front of the person making it.
 *
 * **Opt-in, never a blocking gate.** It reaches over the network to a repository this
 * one does not control, so a GitHub outage or a rate limit must not fail an unrelated
 * MR. It runs when `CHECK_CROSS_REPO=1` (or in CI where that is set deliberately) and
 * skips otherwise — loudly enough to be noticed when the pin matters.
 *
 * Runs in the `node` environment, not the project-wide `happy-dom`: a real cross-origin
 * fetch is blocked by the Same-Origin Policy there, which this test would then report
 * as "network unavailable" and skip — passing while checking nothing.
 *
 * When it fails, the fix is in lt-monorepo, not here: raise the three image pins in
 * `.gitlab-ci.yml` (two jobs) and `.github/workflows/test.yml` (one) to match, and
 * release. Keep them moving in lockstep — the prebuilt image ships the matching browser
 * binaries and neither pipeline runs `playwright install`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MONOREPO_CI_URL = 'https://raw.githubusercontent.com/lenneTech/lt-monorepo/main/.gitlab-ci.yml';
const MONOREPO_GH_URL = 'https://raw.githubusercontent.com/lenneTech/lt-monorepo/main/.github/workflows/test.yml';

/** `mcr.microsoft.com/playwright:v1.62.1-noble` → `1.62.1` */
const IMAGE_TAG_RE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/g;

const enabled = process.env.CHECK_CROSS_REPO === '1';

function localPlaywrightVersion(): string {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'));
  const raw = pkg.devDependencies?.['@playwright/test'] ?? pkg.dependencies?.['@playwright/test'];
  // Project policy is exact pins, but strip a range char defensively rather than
  // failing on something this test does not own.
  return String(raw ?? '').replace(/^[\^~]/, '');
}

async function fetchPinnedVersions(url: string): Promise<string[]> {
  // setup.ts replaces globalThis.fetch with a vi.fn() for every test; it returns
  // `undefined` and would make this contract check vacuously green. Use the real one.
  const realFetch = globalThis.__realFetch;
  const res = await realFetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  const body = await res.text();
  return [...body.matchAll(IMAGE_TAG_RE)].map((m) => m[1] as string);
}

describe.skipIf(!enabled)('Playwright image pin ↔ lt-monorepo', () => {
  it('has an exact local @playwright/test version to compare against', () => {
    expect(localPlaywrightVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('matches every Playwright CI image pinned in lt-monorepo', async () => {
    const local = localPlaywrightVersion();

    let pinned: string[];
    try {
      pinned = [...(await fetchPinnedVersions(MONOREPO_CI_URL)), ...(await fetchPinnedVersions(MONOREPO_GH_URL))];
    } catch (error) {
      // Only a genuine network failure may skip. A TypeError means the test itself is
      // broken (a mocked fetch, a renamed global) — swallowing that is how a guard ends
      // up reporting success while checking nothing, which is the exact defect this
      // test exists to prevent elsewhere.
      if (error instanceof TypeError) {
        throw error;
      }
      console.warn(`[playwright-image-contract] skipped — could not reach lt-monorepo: ${String(error)}`);
      return;
    }

    // A parser that silently matches nothing would make this test vacuously green —
    // exactly the failure mode the monorepo's own guard already has.
    expect(pinned.length, 'found no Playwright image pins in lt-monorepo — has the CI layout changed?').toBeGreaterThan(0);

    const drifted = [...new Set(pinned)].filter((v) => v !== local);
    expect(
      drifted,
      `@playwright/test is ${local} here, but lt-monorepo pins ${drifted.join(', ')}. ` +
        `Raise the image pins in lt-monorepo (.gitlab-ci.yml ×2, .github/workflows/test.yml ×1) to ` +
        `mcr.microsoft.com/playwright:v${local}-noble and release it — otherwise every project ` +
        `generated from this commit starts with a red check:playwright-image.`,
    ).toEqual([]);
  });
});
