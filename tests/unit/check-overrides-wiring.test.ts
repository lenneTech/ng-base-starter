/**
 * How `scripts/check-overrides.mjs` sits in the check chain. The guard itself is covered by
 * check-overrides.guard.spec.ts; this file covers the two places it can be lost on the way.
 *
 * 1. The chain. A guard nobody calls verifies nothing, and nothing fails when it drops out of
 *    `check:raw`, `check:fix` or `check:naf`.
 * 2. The report. The guard exits 0 on its degraded paths (no audit report, npm's advisory service
 *    down, suppressions the Advisory API did not answer for), because an outage elsewhere must not
 *    block a release. An unclassified step renders exit 0 as a plain tick, so a run that checked
 *    nothing would read like one that checked everything. The runner reads the guard's verdict
 *    back out of its output instead, as it already does for check-suppressions.mjs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildGroups, parseOverridesSummary } from '../../scripts/check.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;

describe('check-overrides in the check chain', () => {
  it.each(['check:raw', 'check:fix', 'check:naf'])('%s runs the guard as its own step, right after check-suppressions', (chain) => {
    const { groups } = buildGroups([{ check: scripts[chain] as string, dir: ROOT, name: 'template', rel: '.' }]);
    const kinds = groups[0]!.steps.map((step) => step.kind);
    expect(kinds, `${chain} no longer runs scripts/check-overrides.mjs`).toContain('overrides');
    expect(kinds.indexOf('overrides')).toBe(kinds.indexOf('suppressions') + 1);
  });

  it('exposes the guard as check:overrides for a standalone run', () => {
    expect(scripts['check:overrides']).toBe('node scripts/check-overrides.mjs');
  });
});

describe('parseOverridesSummary', () => {
  const ok = '[overrides] ok — 6 override(s) checked against 0 advisory/advisories from pnpm audit; 0 of them land on an overridden package and none is failing';

  it('reads a full verification', () => {
    expect(parseOverridesSummary(`${ok}; 2/2 suppression(s) verified`)).toEqual({ overrides: 6, state: 'verified' });
    expect(parseOverridesSummary(ok)).toEqual({ overrides: 6, state: 'verified' });
    expect(parseOverridesSummary(`${ok}; 2/2 suppression(s) verified (1 as unusable-fix residual)`)).toEqual({ overrides: 6, state: 'verified' });
  });

  it('reads a run with nothing declared', () => {
    expect(parseOverridesSummary('[overrides] ok — no overrides and no suppressions declared, nothing to verify')).toEqual({ overrides: 0, state: 'none' });
  });

  it('reports a suppression the Advisory API did not answer for as unverified', () => {
    expect(parseOverridesSummary(`[overrides] WARN — could not reach the GitHub Advisory API\n${ok}; 1/2 suppression(s) verified`)).toEqual({ overrides: 6, state: 'unverified' });
  });

  it('reports both exit-0 degraded paths as unverified, never as verified', () => {
    expect(parseOverridesSummary('[overrides] WARN — could not obtain an audit report (spawn pnpm ENOENT).\n  6 override(s) are declared and NONE of them were verified.')).toEqual(
      {
        overrides: 0,
        state: 'unverified',
      },
    );
    expect(parseOverridesSummary("[overrides] WARN — the audit reported an empty tree, but npm's advisory service is unreachable.")).toEqual({ overrides: 0, state: 'unverified' });
  });

  it('strips ANSI codes before reading', () => {
    expect(parseOverridesSummary(`\u001B[32m${ok}\u001B[0m`)).toEqual({ overrides: 6, state: 'verified' });
  });

  it('returns null for output it cannot read', () => {
    expect(parseOverridesSummary('')).toBeNull();
    expect(parseOverridesSummary('[overrides] override(s) or suppression(s) declared as a fix are not fixing anything:')).toBeNull();
  });
});
