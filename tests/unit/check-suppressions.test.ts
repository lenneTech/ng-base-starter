/**
 * `scripts/check-suppressions.mjs` — every `auditConfig.ignoreGhsas` entry is re-checked against
 * the GitHub Advisory Database and the lockfile, so a suppression cannot outlive its reason. pnpm
 * drops suppressed advisories from `pnpm audit --json`, so without this nothing ever says so.
 *
 * Network access is injected or avoided, so every case runs offline. The advisory shapes are the
 * REST API's (`GET /advisories/{ghsa_id}`): `withdrawn_at`, and `vulnerabilities[]` with
 * `package.{ ecosystem, name }`, `vulnerable_version_range` and `first_patched_version` as a
 * string or null. The node-forge advisory GHSA-86w9-cpqp-85rv returned exactly that on
 * 2026-10-02, with `first_patched_version: null`, while `pnpm audit` named ">=1.4.1" and the
 * registry answered 404 for 1.4.1. On 2026-10-28 it still read null, a day after 1.4.1 and 1.4.2
 * were published: the case the registry-derived fix exists for. The registry shape is the full
 * packument's (`GET registry.npmjs.org/{name}`): `versions` with an optional `deprecated`, and
 * `time` with ISO publish dates.
 *
 * Nothing here reads outside the template: these tests ship into generated projects.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { parseSuppressionSummary } from '../../scripts/check.mjs';
import {
  assessSuppression,
  createAdvisoryFetcher,
  createNpmPackumentFetcher,
  dependentsOf,
  exitCodeFor,
  findWorkspaceRoot,
  inVulnerableRange,
  listSuppressions,
  listUnusableFixConsumers,
  minimumReleaseAgeOf,
  parseResidual,
  patchedVersionOf,
  resolvedVersions,
  run,
  summaryLine,
} from '../../scripts/check-suppressions.mjs';
import type { SuppressionResult, SuppressionStatus } from '../../scripts/check-suppressions.mjs';

const ID = 'GHSA-86w9-cpqp-85rv';
const TEMPLATE = join(import.meta.dirname, '..', '..');
// Lockfile and suppressions live at the workspace root: the template itself when it
// stands alone, the monorepo root once `lt fullstack init` put the app under projects/.
const WORKSPACE = findWorkspaceRoot(TEMPLATE) ?? TEMPLATE;

function npm(name: string, firstPatched: unknown, range = '<= 1.4.0') {
  return { first_patched_version: firstPatched, package: { ecosystem: 'npm', name }, vulnerable_version_range: range };
}

/** When the suite pretends to run: 2026-10-28 12:00 UTC, the day GHSA-86w9 still named no fix. */
const NOW = Date.parse('2026-10-28T12:00:00Z');

/** node-forge's real publish times, read from registry.npmjs.org/node-forge on 2026-10-28. */
const FORGE_TIME = {
  '1.4.0': '2026-03-24T21:44:34.668Z',
  '1.4.1': '2026-10-27T04:44:07.718Z',
  '1.4.2': '2026-10-27T14:09:15.471Z',
};

/** A packument with `versions`, each published in 2020 unless `time` says otherwise. */
function registry(versions: string[], { deprecated = [], time = {} }: { deprecated?: string[]; time?: Record<string, string> } = {}) {
  return {
    time: Object.fromEntries(versions.map((v) => [v, time[v] ?? '2020-01-01T00:00:00Z'])),
    versions: Object.fromEntries(versions.map((v) => [v, deprecated.includes(v) ? { deprecated: 'do not use' } : {}])),
  };
}

function deps({
  advisory,
  fetchFails,
  gate = 1440,
  locked = ['1.4.0'],
  now = NOW,
  packument = registry(['1.4.0']),
}: {
  advisory?: unknown;
  fetchFails?: string;
  gate?: number;
  locked?: string[] | null;
  now?: number;
  packument?: ReturnType<typeof registry> | null;
}) {
  return {
    fetchAdvisory: vi.fn(async () => (fetchFails ? { ok: false as const, reason: fetchFails } : { advisory, ok: true as const })),
    lockedVersions: vi.fn(() => locked),
    minimumReleaseAgeMinutes: gate,
    now,
    npmPackument: vi.fn(async (_name: string) => packument),
  };
}

const result = (status: SuppressionStatus): SuppressionResult => ({ detail: '', id: ID, status });

describe('assessSuppression', () => {
  it('still holds while no release on the registry lies outside the vulnerable range', async () => {
    const d = deps({ advisory: { vulnerabilities: [npm('node-forge', null)], withdrawn_at: null }, packument: registry(['1.3.3', '1.4.0']) });
    expect((await assessSuppression(ID, d)).status).toBe('unfixable');
  });

  it('still holds while the named fix is not on the registry (the node-forge 1.4.1 case)', async () => {
    const d = deps({ advisory: { vulnerabilities: [npm('node-forge', '1.4.1')] } });
    expect(await assessSuppression(ID, d)).toMatchObject({ detail: expect.stringContaining('node-forge@1.4.1'), status: 'fix-unpublished' });
    expect(d.npmPackument).toHaveBeenCalledWith('node-forge');
  });

  it('fails once the named fix is published', async () => {
    const d = deps({ advisory: { vulnerabilities: [npm('node-forge', '1.4.1')] }, packument: registry(['1.4.0', '1.4.1']) });
    expect(await assessSuppression(ID, d)).toMatchObject({ detail: 'node-forge@1.4.1 is published', status: 'fix-available' });
  });

  it('fails when the advisory was withdrawn', async () => {
    expect((await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', null)], withdrawn_at: '2026-11-01T00:00:00Z' } }))).status).toBe('withdrawn');
  });

  it('fails when the package no longer resolves in the vulnerable range (the image-size case)', async () => {
    const r = await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', null)] }, locked: ['1.5.0'] }));
    expect(r).toMatchObject({ detail: expect.stringContaining('node-forge@1.5.0'), status: 'not-present' });
    expect((await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', null)] }, locked: [] }))).status).toBe('not-present');
  });

  it('is unverified — never "still holds" — when it cannot look', async () => {
    expect((await assessSuppression(ID, deps({ fetchFails: 'GitHub Advisory API unreachable (ENOTFOUND)' }))).status).toBe('unverified');
    expect((await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', null)] }, locked: null }))).status).toBe('unverified');
    expect((await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', null, 'some day')] } }))).status).toBe('unverified');
    expect(await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', '1.4.1')] }, packument: null }))).toMatchObject({
      detail: expect.stringContaining('node-forge'),
      status: 'unverified',
    });
  });

  it('ignores other ecosystems, and is unverified when no npm package is named', async () => {
    const pip = { first_patched_version: '9.9.9', package: { ecosystem: 'pip', name: 'forge' }, vulnerable_version_range: '< 9.9.9' };
    const d = deps({ advisory: { vulnerabilities: [pip, npm('node-forge', null)] } });
    expect((await assessSuppression(ID, d)).status).toBe('unfixable');
    expect(d.npmPackument.mock.calls).toEqual([['node-forge']]);
    expect((await assessSuppression(ID, deps({ advisory: { vulnerabilities: [pip] } }))).status).toBe('unverified');
  });
});

describe('assessSuppression: a fix the advisory does not name, and the release-age gate', () => {
  const forge = { vulnerabilities: [npm('node-forge', null)] };

  it('fails on a published fix although first_patched_version is null (GHSA-86w9, 2026-10-28)', async () => {
    const r = await assessSuppression(ID, deps({ advisory: forge, packument: registry(['1.4.0', '1.4.1', '1.4.2'], { time: FORGE_TIME }) }));
    expect(r).toMatchObject({ detail: expect.stringContaining('node-forge@1.4.1'), status: 'fix-available' });
    expect(r.detail).toContain('names no patched version');
  });

  it('still holds while the fix is younger than the gate, and says when it clears', async () => {
    // 2026-10-27 10:00 UTC: 1.4.1 was five hours old and 1.4.2 not yet published.
    const d = deps({ advisory: forge, now: Date.parse('2026-10-27T10:00:00Z'), packument: registry(['1.4.0', '1.4.1'], { time: FORGE_TIME }) });
    const r = await assessSuppression(ID, d);
    expect(r).toMatchObject({ detail: expect.stringContaining('until 2026-10-28 04:44 UTC'), status: 'fix-in-quarantine' });
    expect(r.detail).toContain('24h minimumReleaseAge gate');
    expect(exitCodeFor([r], { ci: true, token: true })).toBe(0);
  });

  it('honours the configured gate in both directions', async () => {
    const packument = registry(['1.4.0', '1.4.1', '1.4.2'], { time: FORGE_TIME });
    expect(await assessSuppression(ID, deps({ advisory: forge, gate: 10_080, packument }))).toMatchObject({ detail: expect.stringContaining('7d'), status: 'fix-in-quarantine' });
    expect((await assessSuppression(ID, deps({ advisory: forge, gate: 0, now: Date.parse('2026-10-27T05:00:00Z'), packument }))).status).toBe('fix-available');
  });

  it('holds a named fix to the same gate', async () => {
    const d = deps({
      advisory: { vulnerabilities: [npm('node-forge', '1.4.1')] },
      now: Date.parse('2026-10-27T10:00:00Z'),
      packument: registry(['1.4.0', '1.4.1'], { time: FORGE_TIME }),
    });
    expect((await assessSuppression(ID, d)).status).toBe('fix-in-quarantine');
  });

  it('skips pre-releases and deprecated releases', async () => {
    const packument = registry(['1.4.0', '1.4.1-rc.1', '1.4.1', '1.4.2'], { deprecated: ['1.4.1'] });
    expect(await assessSuppression(ID, deps({ advisory: forge, packument }))).toMatchObject({ detail: expect.stringContaining('node-forge@1.4.2'), status: 'fix-available' });
  });

  it('still fails when only deprecated releases leave the range (a retired package)', async () => {
    // node-sass: all 132 stable releases are deprecated, the named fix 7.0.0 included. pnpm installs a
    // deprecated release all the same, so calling the entry "unfixable" kept a fixable copy in the
    // tree with check green, where the named-fix probe before 2.33.3 had gone red.
    const allDeprecated = registry(['1.4.0', '1.4.1', '1.4.2'], { deprecated: ['1.4.0', '1.4.1', '1.4.2'] });
    const named = await assessSuppression(ID, deps({ advisory: { vulnerabilities: [npm('node-forge', '1.4.1')] }, packument: allDeprecated }));
    expect(named).toMatchObject({ detail: expect.stringContaining('node-forge@1.4.1 is published'), status: 'fix-available' });
    expect(named.detail).toContain('deprecated');
    expect(await assessSuppression(ID, deps({ advisory: forge, packument: allDeprecated }))).toMatchObject({
      detail: expect.stringContaining('node-forge@1.4.1'),
      status: 'fix-available',
    });
  });

  it('takes only a release outside EVERY range of the package', async () => {
    const twoLines = { vulnerabilities: [npm('node-forge', null, '< 1.4.2'), npm('node-forge', null, '>= 1.5.0, < 1.5.3')] };
    expect(await assessSuppression(ID, deps({ advisory: twoLines, packument: registry(['1.4.0', '1.5.0', '1.5.3']) }))).toMatchObject({
      detail: expect.stringContaining('node-forge@1.5.3'),
      status: 'fix-available',
    });
  });

  it('never goes below a named first patched version', async () => {
    const d = deps({ advisory: { vulnerabilities: [npm('node-forge', '1.4.2')] }, packument: registry(['1.4.0', '1.4.1', '1.4.2']) });
    expect(await assessSuppression(ID, d)).toMatchObject({ detail: 'node-forge@1.4.2 is published', status: 'fix-available' });
  });

  it('keeps the entry while one vulnerable copy has no fix, even when another has', async () => {
    const twoLines = { vulnerabilities: [npm('node-forge', null), npm('node-forge', null, '>= 2.0.0, < 2.0.5')] };
    const d = deps({ advisory: twoLines, locked: ['1.4.0', '2.0.1'], packument: registry(['1.4.0', '1.4.1', '2.0.1']) });
    expect(await assessSuppression(ID, d)).toMatchObject({ detail: expect.stringContaining('above 2.0.1'), status: 'unfixable' });
    expect(d.npmPackument).toHaveBeenCalledTimes(1);
  });
});

/** A pnpm v9 lockfile: the root importer's dependencies, then one snapshot per `key: [edge, …]`. */
function lockfile(snapshots: Record<string, string[]>, importer: string[] = []) {
  const lines = ["lockfileVersion: '9.0'", '', 'importers:', '', '  .:'];
  if (importer.length) lines.push('    dependencies:', ...importer.flatMap((name) => [`      ${name}:`, '        specifier: 1.0.0', '        version: 1.0.0']));
  lines.push('', 'snapshots:', '');
  for (const [key, edges] of Object.entries(snapshots)) {
    lines.push(edges.length ? `  ${key}:` : `  ${key}: {}`);
    if (edges.length) lines.push('    dependencies:', ...edges.map((edge) => `      ${edge}`));
    lines.push('');
  }
  return lines.join('\n');
}

// GHSA-g3hv-75wg-m249 as the Advisory API answered on 2026-11-01, and the three minimatch copies
// the template resolved that day. Each is pulled by a consumer on its newest release, none of which
// accepts minimatch 11: glob 10 (via archiver-utils), glob 13 (via @vercel/nft and rimraf),
// readdir-glob 1 (via archiver).
const MINIMATCH = 'GHSA-g3hv-75wg-m249';
const MINIMATCH_ADVISORY = { vulnerabilities: [npm('minimatch', '11.0.1', '< 11.0.1')], withdrawn_at: null };
const MINIMATCH_REGISTRY = registry(['5.1.9', '9.0.9', '10.2.6', '11.0.1'], { time: { '11.0.1': '2026-10-27T22:26:03.755Z' } });
const APP_TREE = {
  'glob@10.5.0': ['minimatch: 9.0.9'],
  'glob@13.0.6': ['minimatch: 10.2.6'],
  'minimatch@10.2.6': [],
  'minimatch@5.1.9': [],
  'minimatch@9.0.9': [],
  'readdir-glob@1.1.3': ['minimatch: 5.1.9'],
  'rimraf@6.1.3': ['glob: 13.0.6'],
};
const DECLARED = 'glob@10.5.0 + glob@13.0.6 + readdir-glob@1.1.3 cannot use 11.0.1';

function declared(
  lock: string,
  {
    advisory = MINIMATCH_ADVISORY,
    declarations = { [MINIMATCH]: DECLARED },
    now = Date.parse('2026-11-01T12:00:00Z'),
    packument = MINIMATCH_REGISTRY,
  }: { advisory?: unknown; declarations?: Record<string, string>; now?: number; packument?: ReturnType<typeof registry> } = {},
) {
  return {
    fetchAdvisory: async () => ({ advisory, ok: true as const }),
    lockedParents: (name: string, ranges: string[]) => dependentsOf(lock, name, ranges),
    lockedVersions: (name: string) => resolvedVersions(lock, name),
    now,
    npmPackument: async () => packument,
    unusableFixConsumers: declarations,
  };
}

describe('assessSuppression: a fix the consumers cannot use (auditConfig.unusableFixConsumers)', () => {
  it('still holds while the declaration matches the tree', async () => {
    const r = await assessSuppression(MINIMATCH, declared(lockfile(APP_TREE)));
    expect(r).toMatchObject({ detail: expect.stringContaining('minimatch@11.0.1 is published'), status: 'unusable-fix' });
    expect(r.detail).toContain('glob@10.5.0 + glob@13.0.6 + readdir-glob@1.1.3 cannot use it');
    expect(exitCodeFor([r], { ci: true, token: true })).toBe(0);
  });

  it('fails as "fix available" without a declaration, exactly as before', async () => {
    expect((await assessSuppression(MINIMATCH, declared(lockfile(APP_TREE), { declarations: {} }))).status).toBe('fix-available');
  });

  it('re-tests a declaration hoisted next to consumers it does not name (the generated monorepo)', async () => {
    // nest-server-starter's declaration names the API's consumers; the app brings its own.
    const lock = lockfile({ ...APP_TREE, 'nodemon@3.1.14': ['minimatch: 10.2.6'] });
    const r = await assessSuppression(MINIMATCH, declared(lock, { declarations: { [MINIMATCH]: 'glob@13.0.6 + nodemon@3.1.14 cannot use 11.0.1' } }));
    expect(r).toMatchObject({ detail: expect.stringContaining('glob@10.5.0, readdir-glob@1.1.3 also pull an affected package'), status: 're-test' });
    expect(exitCodeFor([r], { ci: false, token: false })).toBe(1);
  });

  it('ignores an edge into the fixed version (the generated monorepo once the app is lifted)', async () => {
    // nest-server-starter's declaration, hoisted next to an app whose glob 14 and readdir-glob pull
    // the patched minimatch 11.0.3. Those are no consumers of the vulnerability; counting them kept
    // a correct declaration red for good.
    const lock = lockfile({
      "'@nestjs/cli@12.0.11'": ['minimatch: 10.2.6'],
      'glob@14.0.3': ['minimatch: 11.0.3'],
      'minimatch@10.2.6': [],
      'minimatch@11.0.3': [],
      'nodemon@3.1.14': ['minimatch: 10.2.6'],
      'readdir-glob@1.1.3': ['minimatch: 11.0.3'],
    });
    const declarations = { [MINIMATCH]: '@nestjs/cli@12.0.11 + nodemon@3.1.14 cannot use 11.0.1' };
    expect(await assessSuppression(MINIMATCH, declared(lock, { declarations }))).toMatchObject({
      detail: expect.stringContaining('@nestjs/cli@12.0.11 + nodemon@3.1.14 cannot use it'),
      status: 'unusable-fix',
    });
    // A declared consumer that now pulls only the fixed version covers a path that is gone.
    const lifted = { [MINIMATCH]: '@nestjs/cli@12.0.11 + nodemon@3.1.14 + readdir-glob@1.1.3 cannot use 11.0.1' };
    expect(await assessSuppression(MINIMATCH, declared(lock, { declarations: lifted }))).toMatchObject({
      detail: expect.stringContaining('readdir-glob@1.1.3 pulls no affected package any more'),
      status: 're-test',
    });
  });

  it('still counts an edge whose version it cannot read (fail-closed)', async () => {
    const lock = lockfile({ ...APP_TREE, 'odd-tool@1.0.0': ['minimatch: link:../minimatch'] });
    expect(await assessSuppression(MINIMATCH, declared(lock))).toMatchObject({ detail: expect.stringContaining('odd-tool@1.0.0 also pulls'), status: 're-test' });
  });

  it('counts a consumer that pulls the affected package through an npm alias', async () => {
    // pnpm keys an aliased edge by the alias. Matched by its key, this consumer stayed invisible
    // and the declaration passed as "nothing else pulls it" (review of 2026-11-03).
    const lock = lockfile({ ...APP_TREE, 'other-tool@2.0.0': ['mm-cjs: minimatch@5.1.9'] });
    expect(await assessSuppression(MINIMATCH, declared(lock))).toMatchObject({ detail: expect.stringContaining('other-tool@2.0.0 also pulls'), status: 're-test' });
  });

  it('keeps a declared consumer that reaches the affected package only through an alias', async () => {
    const lock = lockfile({ ...APP_TREE, 'readdir-glob@1.1.3': ['mm-cjs: minimatch@5.1.9'] });
    expect((await assessSuppression(MINIMATCH, declared(lock))).status).toBe('unusable-fix');
  });

  it('re-tests once a declared consumer moved or left the tree', async () => {
    const moved = await assessSuppression(
      MINIMATCH,
      declared(lockfile(APP_TREE), { declarations: { [MINIMATCH]: 'glob@10.5.0 + glob@13.0.5 + readdir-glob@1.1.3 cannot use 11.0.1' } }),
    );
    expect(moved).toMatchObject({ detail: expect.stringContaining('glob moved from 13.0.5 to 10.5.0, 13.0.6'), status: 're-test' });
    const gone = await assessSuppression(MINIMATCH, declared(lockfile(APP_TREE), { declarations: { [MINIMATCH]: DECLARED.replace(' cannot', ' + nodemon@3.1.14 cannot') } }));
    expect(gone).toMatchObject({ detail: expect.stringContaining('no nodemon in the tree any more'), status: 're-test' });
  });

  it('re-tests a second version of a declared consumer, which nobody assessed', async () => {
    const r = await assessSuppression(MINIMATCH, declared(lockfile({ ...APP_TREE, 'glob@13.0.7': ['minimatch: 10.2.6'] })));
    expect(r).toMatchObject({ detail: expect.stringContaining('glob@13.0.7 also pulls an affected package'), status: 're-test' });
  });

  it('re-tests a declared consumer that pulls nothing affected any more', async () => {
    const r = await assessSuppression(MINIMATCH, declared(lockfile(APP_TREE), { declarations: { [MINIMATCH]: DECLARED.replace(' cannot', ' + rimraf@6.1.3 cannot') } }));
    expect(r).toMatchObject({ detail: expect.stringContaining('rimraf@6.1.3 pulls no affected package any more'), status: 're-test' });
  });

  it('re-tests when the workspace itself depends on the affected package', async () => {
    const r = await assessSuppression(MINIMATCH, declared(lockfile(APP_TREE, ['minimatch'])));
    expect(r).toMatchObject({ detail: expect.stringContaining("the workspace package '.' also pulls"), status: 're-test' });
  });

  it('re-tests a fix in a line nobody assessed (the backport case)', async () => {
    const advisory = { vulnerabilities: [npm('minimatch', '10.2.7', '< 10.2.7'), npm('minimatch', '11.0.1', '>= 11.0.0, < 11.0.1')] };
    const packument = registry(['5.1.9', '9.0.9', '10.2.6', '10.2.7', '11.0.1']);
    const r = await assessSuppression(MINIMATCH, declared(lockfile(APP_TREE), { advisory, packument }));
    expect(r).toMatchObject({ detail: expect.stringContaining('the advisory now offers 10.2.7, which was never assessed (rejected: 11.0.1)'), status: 're-test' });
    const unrecorded = await assessSuppression(MINIMATCH, declared(lockfile(APP_TREE), { declarations: { [MINIMATCH]: 'glob@10.5.0 + glob@13.0.6 + readdir-glob@1.1.3' } }));
    expect(unrecorded).toMatchObject({ detail: expect.stringContaining('rejected: nothing recorded'), status: 're-test' });
  });

  it('re-tests — never "still holds" — when the edges cannot be read', async () => {
    const unreadable = { ...declared(lockfile(APP_TREE)), lockedParents: () => null };
    expect(await assessSuppression(MINIMATCH, unreadable)).toMatchObject({ detail: expect.stringContaining('unverifiable'), status: 're-test' });
    const { lockedParents: _omitted, ...withoutEdges } = declared(lockfile(APP_TREE));
    expect((await assessSuppression(MINIMATCH, withoutEdges)).status).toBe('re-test');
  });

  it('rescues nothing else: obsolete stays obsolete, a maturing fix still matures', async () => {
    const fixed = lockfile({ 'glob@14.0.3': ['minimatch: 11.0.3'], 'minimatch@11.0.3': [] });
    expect((await assessSuppression(MINIMATCH, declared(fixed))).status).toBe('not-present');
    expect((await assessSuppression(MINIMATCH, declared(lockfile(APP_TREE), { advisory: { ...MINIMATCH_ADVISORY, withdrawn_at: '2026-11-02T00:00:00Z' } }))).status).toBe(
      'withdrawn',
    );
    expect((await assessSuppression(MINIMATCH, declared(lockfile(APP_TREE), { now: Date.parse('2026-10-28T08:00:00Z') }))).status).toBe('fix-in-quarantine');
  });
});

describe('reading a declaration', () => {
  it("reads nest-server-starter's block as lt hoists it, comments and all", () => {
    const yaml = [
      'auditConfig:',
      '  # ACTIVE since 2026-11-01 (owner decision).',
      '  ignoreGhsas:',
      '    - GHSA-g3hv-75wg-m249',
      '    - GHSA-3g3m-2fjr-6pw4',
      '  unusableFixConsumers:',
      "    GHSA-g3hv-75wg-m249: '@nestjs/cli@12.0.11 + @swc/cli@0.8.2 + @ts-morph/common@0.29.0 + glob@13.0.6 + nodemon@3.1.14 cannot use 11.0.1'",
      '    # retired: GHSA-aaaa-bbbb-cccc',
      "    GHSA-3g3m-2fjr-6pw4: 'rimraf@6.1.3 cannot use 14.0.2' # assessed 2026-11-01",
      'overrides:',
      "  GHSA-dddd-eeee-ffff: 'not a declaration'",
    ].join('\n');
    expect(listUnusableFixConsumers(yaml)).toEqual({
      'GHSA-3g3m-2fjr-6pw4': 'rimraf@6.1.3 cannot use 14.0.2',
      'GHSA-g3hv-75wg-m249': '@nestjs/cli@12.0.11 + @swc/cli@0.8.2 + @ts-morph/common@0.29.0 + glob@13.0.6 + nodemon@3.1.14 cannot use 11.0.1',
    });
  });

  it('takes any quoting, stops at the next sibling key, and does not read a flow mapping', () => {
    const yaml =
      'auditConfig:\n  unusableFixConsumers:\n    "GHSA-aaaa-bbbb-cccc": "a@1.0.0 cannot use 2.0.0"\n    GHSA-dddd-eeee-ffff: b@1.0.0 cannot use 3.0.0\n  ignoreGhsas:\n    - GHSA-aaaa-bbbb-cccc\n';
    expect(listUnusableFixConsumers(yaml)).toEqual({ 'GHSA-aaaa-bbbb-cccc': 'a@1.0.0 cannot use 2.0.0', 'GHSA-dddd-eeee-ffff': 'b@1.0.0 cannot use 3.0.0' });
    expect(listUnusableFixConsumers("auditConfig:\n  unusableFixConsumers: { GHSA-aaaa-bbbb-cccc: 'a@1.0.0 cannot use 2.0.0' }\n")).toEqual({});
    expect(listUnusableFixConsumers('auditConfig:\n  ignoreGhsas: []\n')).toEqual({});
  });

  it('splits consumers at the last @ and keeps every rejected version', () => {
    expect(parseResidual('@nuxt/devtools@3.4.1 cannot use 4.0.1')).toEqual({ consumers: [{ assessedAt: '3.4.1', consumer: '@nuxt/devtools' }], rejected: ['4.0.1'] });
    expect(parseResidual('a@1.0.0 + @s/b@2.0.0 cannot use 1.0.1, 2.0.3')).toEqual({
      consumers: [
        { assessedAt: '1.0.0', consumer: 'a' },
        { assessedAt: '2.0.0', consumer: '@s/b' },
      ],
      rejected: ['1.0.1', '2.0.3'],
    });
    expect(parseResidual('a@1.0.0').rejected).toEqual([]);
  });
});

describe('dependentsOf', () => {
  it('reads both lockfile halves, keeps the version, cuts the peer suffix', () => {
    const lock = lockfile({ "'@vercel/nft@1.11.0(rollup@4.65.1)(supports-color@10.2.2)'": ['glob: 13.0.6', 'glob-parent: 6.0.2'], 'glob@13.0.6': [] }, ['glob']);
    expect(dependentsOf(lock, 'glob')).toEqual({ parents: ["the workspace package '.'", '@vercel/nft@1.11.0'], scanned: true });
    expect(dependentsOf(lock, 'glob-parent').parents).toEqual(['@vercel/nft@1.11.0']);
  });

  it('counts optionalDependencies, not a transitivePeerDependencies list', () => {
    const lock = ['snapshots:', '', '  a@1.0.0:', '    optionalDependencies:', '      glob: 13.0.6', '    transitivePeerDependencies:', '      - minimatch', ''].join('\n');
    expect(dependentsOf(lock, 'glob').parents).toEqual(['a@1.0.0']);
    expect(dependentsOf(lock, 'minimatch').parents).toEqual([]);
  });

  it('counts only edges into an affected version when given the ranges, an importer by its version line', () => {
    const lock = [
      'importers:',
      '',
      '  .:',
      '    devDependencies:',
      '      minimatch:',
      '        specifier: 11.0.3',
      '        version: 11.0.3',
      '  projects/api:',
      '    dependencies:',
      '      minimatch:',
      '        specifier: ^10.0.0',
      '        version: 10.2.6',
      '',
      'snapshots:',
      '',
      '  glob@14.0.3:',
      '    dependencies:',
      '      minimatch: 11.0.3',
      '',
      "  '@nestjs/cli@12.0.11':",
      '    dependencies:',
      '      minimatch: 10.2.6(peer@1.0.0)',
      '',
      '  aliased@1.0.0:',
      '    dependencies:',
      // An alias into the FIXED release: read through the alias, it drops out.
      '      minimatch: minimatch@11.0.3',
      '',
      '  linked@1.0.0:',
      '    dependencies:',
      '      minimatch: link:../mm',
      '',
    ].join('\n');
    expect(dependentsOf(lock, 'minimatch', ['< 11.0.1']).parents).toEqual(["the workspace package 'projects/api'", '@nestjs/cli@12.0.11', 'linked@1.0.0']);
    // Without ranges, and with a range it cannot parse, every edge counts.
    expect(dependentsOf(lock, 'minimatch').parents).toHaveLength(6);
    expect(dependentsOf(lock, 'minimatch', ['some day']).parents).toHaveLength(6);
  });

  it('matches an edge by the package it pulls, so an npm alias counts by its target', () => {
    const lock = [
      'importers:',
      '',
      '  .:',
      '    devDependencies:',
      '      mm-legacy:',
      '        specifier: npm:minimatch@^5',
      '        version: minimatch@5.1.9',
      '',
      'snapshots:',
      '',
      '  other-tool@2.0.0:',
      '    dependencies:',
      '      mm-cjs: minimatch@5.1.9(peer@1.0.0)',
      '      minimatch: some-fork@1.0.0',
      '',
      "  '@s/tool@1.0.0':",
      '    dependencies:',
      "      '@s/glob-cjs': '@s/glob@13.0.6'",
      '',
    ].join('\n');
    expect(dependentsOf(lock, 'minimatch', ['< 11.0.1']).parents).toEqual(["the workspace package '.'", 'other-tool@2.0.0']);
    expect(dependentsOf(lock, '@s/glob', ['< 14.0.2']).parents).toEqual(['@s/tool@1.0.0']);
    // Keyed `minimatch` but pulling some-fork: an edge of some-fork, not of minimatch.
    expect(dependentsOf(lock, 'some-fork').parents).toEqual(['other-tool@2.0.0']);
  });

  it('says when it could not look', () => {
    expect(dependentsOf("lockfileVersion: '9.0'\n\npackages:\n\n  glob@13.0.6:\n", 'glob')).toEqual({ parents: [], scanned: false });
  });

  it("reads the template's real lockfile", () => {
    const { parents, scanned } = dependentsOf(readFileSync(join(WORKSPACE, 'pnpm-lock.yaml'), 'utf8'), '@angular/platform-server');
    expect(scanned).toBe(true);
    expect(parents.length).toBeGreaterThan(0);
    for (const parent of parents) expect(parent).toMatch(/^(the workspace package '.+'|(@[^/@]+\/)?[^/@]+@\d[^(\s]*)$/);
  });
});

describe('exitCodeFor', () => {
  it('fails a declaration that needs a re-test everywhere, and passes one that holds', () => {
    expect(exitCodeFor([result('unfixable'), result('re-test')], { ci: false, token: false })).toBe(1);
    expect(exitCodeFor([result('unusable-fix')], { ci: true, token: true })).toBe(0);
  });

  it('fails an obsolete entry everywhere', () => {
    for (const status of ['fix-available', 'not-present', 'withdrawn'] as const) {
      expect(exitCodeFor([result('unfixable'), result(status)], { ci: false, token: false })).toBe(1);
      expect(exitCodeFor([result(status)], { ci: true, token: false })).toBe(1);
    }
  });

  it('fails an unverified entry only in CI with a token, where the lookup should have worked', () => {
    expect(exitCodeFor([result('unverified')], { ci: true, token: true })).toBe(1);
    // GitLab runners share one IP across every project: without a token, rate limits are expected.
    expect(exitCodeFor([result('unverified')], { ci: true, token: false })).toBe(0);
    expect(exitCodeFor([result('unverified')], { ci: false, token: true })).toBe(0);
  });

  it('passes entries that still hold, including an unpublished or a maturing fix', () => {
    expect(exitCodeFor([result('unfixable'), result('fix-unpublished')], { ci: true, token: true })).toBe(0);
    expect(exitCodeFor([result('unfixable'), result('fix-in-quarantine')], { ci: true, token: true })).toBe(0);
  });
});

describe('summary line: producer (check-suppressions.mjs) and reader (check.mjs) agree', () => {
  it('round-trips every state', () => {
    expect(parseSuppressionSummary(summaryLine([]))).toEqual({ count: 0, state: 'none', total: 0 });
    expect(parseSuppressionSummary(summaryLine([result('unfixable'), result('fix-unpublished')]))).toEqual({ count: 2, state: 'verified', total: 2 });
    expect(parseSuppressionSummary(summaryLine([result('fix-in-quarantine')]))).toEqual({ count: 1, state: 'verified', total: 1 });
    expect(parseSuppressionSummary(summaryLine([result('unfixable'), result('unverified')]))).toEqual({ count: 1, state: 'unverified', total: 2 });
    expect(parseSuppressionSummary(summaryLine([result('unverified'), result('not-present')]))).toEqual({ count: 1, state: 'obsolete', total: 2 });
    expect(parseSuppressionSummary(summaryLine([result('unusable-fix'), result('re-test')]))).toEqual({ count: 1, state: 'retest', total: 2 });
    expect(parseSuppressionSummary(summaryLine([result('re-test'), result('not-present')]))).toEqual({ count: 1, state: 'obsolete', total: 2 });
    expect(parseSuppressionSummary(summaryLine([result('unusable-fix')]))).toEqual({ count: 1, state: 'verified', total: 1 });
  });

  it('reads nothing as verified when the line is missing, and survives colour', () => {
    expect(parseSuppressionSummary('Error: something else entirely')).toBeNull();
    expect(parseSuppressionSummary('\x1b[2m[suppressions] verified 1 of 1\x1b[22m')).toEqual({ count: 1, state: 'verified', total: 1 });
  });
});

describe('lockfile and range reading', () => {
  const LOCK = [
    'packages:',
    '',
    '  node-forge@1.4.0:',
    "  '@nuxt/kit@4.5.2':",
    '  /left-pad@1.3.0:',
    '',
    'snapshots:',
    '',
    "  '@nuxt/kit@4.5.2(magic-string@1.4.2)':",
    '  node-forge-extra@9.9.9: {}',
    '    node-forge: 1.4.0',
  ].join('\n');

  it('reads every version of the named package, and only of that package', () => {
    expect(resolvedVersions(LOCK, 'node-forge')).toEqual(['1.4.0']);
    expect(resolvedVersions(LOCK, '@nuxt/kit')).toEqual(['4.5.2']);
    expect(resolvedVersions(LOCK, 'left-pad')).toEqual(['1.3.0']);
    expect(resolvedVersions(LOCK, 'absent')).toEqual([]);
  });

  it("reads the template's real lockfile", () => {
    // @angular/core resolves in every project made from this template, so this holds after any
    // bump. The full-match pattern fails when the parser leaves a peer suffix such as `(rxjs@…)`
    // on the version.
    const versions = resolvedVersions(readFileSync(join(WORKSPACE, 'pnpm-lock.yaml'), 'utf8'), '@angular/core');
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    }
  });

  it('honours every operator at its boundary, and says when it cannot tell', () => {
    expect(inVulnerableRange('1.4.0', '<= 1.4.0')).toBe(true);
    expect(inVulnerableRange('1.4.1', '<= 1.4.0')).toBe(false);
    expect(inVulnerableRange('1.4.0', '< 1.4.0')).toBe(false);
    expect(inVulnerableRange('2.1.3', '>= 2.0.0, < 2.1.4')).toBe(true);
    expect(inVulnerableRange('2.1.4', '>= 2.0.0, < 2.1.4')).toBe(false);
    expect(inVulnerableRange('1.2.3', '= 1.2.3')).toBe(true);
    expect(inVulnerableRange('1.4.0-beta.1', '<= 1.4.0')).toBe(true);
    expect(inVulnerableRange('1.0.0', 'some day')).toBeNull();
    expect(inVulnerableRange('1.0.0', '')).toBeNull();
  });

  it('reads the REST and GraphQL shape of a patched version', () => {
    expect(patchedVersionOf({ first_patched_version: '1.4.1' })).toBe('1.4.1');
    expect(patchedVersionOf({ first_patched_version: { identifier: '1.4.1' } })).toBe('1.4.1');
    expect(patchedVersionOf({ first_patched_version: null })).toBeNull();
  });
});

describe('where the entries are read from', () => {
  it('lists block and inline entries, and skips retired (commented) ones', () => {
    expect(listSuppressions('auditConfig:\n  ignoreGhsas:\n    # why\n    - GHSA-aaaa-bbbb-cccc\n    # - GHSA-dddd-eeee-ffff\nallowBuilds:\n')).toEqual(['GHSA-aaaa-bbbb-cccc']);
    expect(listSuppressions('auditConfig:\n  ignoreGhsas: [GHSA-aaaa-bbbb-cccc, GHSA-dddd-eeee-ffff]\n')).toHaveLength(2);
    expect(listSuppressions('packages: []\n')).toEqual([]);
  });

  it('lists exactly the entries the real pnpm-workspace.yaml declares', () => {
    const text = readFileSync(join(WORKSPACE, 'pnpm-workspace.yaml'), 'utf8');
    // Independent oracle: every uncommented `- GHSA-…` list item. Naming one advisory here broke
    // the day that suppression was retired, in this template and in every generated project.
    const declared = [...text.matchAll(/^\s+- (GHSA-[0-9a-z-]+)\s*$/gm)].map((match) => match[1]);
    expect(listSuppressions(text)).toEqual(declared);
  });

  it('walks up to the nearest pnpm-workspace.yaml, as pnpm does', () => {
    // Native paths: the walk joins with node:path, so on Windows it asks for `D:\mono\…`.
    const mono = resolve('/mono');
    const app = join(mono, 'projects', 'app');
    const files = new Set([join(mono, 'pnpm-workspace.yaml')]);
    const exists = (p: string) => files.has(p);
    // Generated monorepo: lt hoisted auditConfig into the root and deleted the app's file.
    expect(findWorkspaceRoot(app, exists)).toBe(mono);
    // Standalone, or an app that kept its own file: that one wins.
    files.add(join(app, 'pnpm-workspace.yaml'));
    expect(findWorkspaceRoot(app, exists)).toBe(app);
    expect(findWorkspaceRoot(resolve('/elsewhere'), () => false)).toBeNull();
  });

  it('run() finds the hoisted root file in a monorepo layout, offline when nothing is suppressed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-suppressions-'));
    try {
      mkdirSync(join(dir, 'projects', 'app'), { recursive: true });
      writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
      const lines: string[] = [];
      expect(await run({ cwd: join(dir, 'projects', 'app'), env: {}, log: (l) => lines.push(l) })).toBe(0);
      expect(lines).toEqual(['[suppressions] none declared']);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('run() reads the hoisted declaration and the lockfile edges next to the entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-suppressions-'));
    // Answers the two lookups run() makes; every other URL is a test bug, not an outage.
    vi.stubGlobal('fetch', async (url: string) => {
      const body = url.startsWith('https://api.github.com/advisories/') ? MINIMATCH_ADVISORY : url === 'https://registry.npmjs.org/minimatch' ? MINIMATCH_REGISTRY : null;
      if (!body) throw new Error(`unexpected fetch ${url}`);
      return { headers: new Headers(), json: async () => body, status: 200 };
    });
    const runWith = async (declaration: string) => {
      writeFileSync(
        join(dir, 'pnpm-workspace.yaml'),
        `packages:\n  - 'projects/*'\nauditConfig:\n  ignoreGhsas:\n    - ${MINIMATCH}\n  unusableFixConsumers:\n    ${MINIMATCH}: '${declaration}'\n`,
      );
      const lines: string[] = [];
      const code = await run({ cwd: join(dir, 'projects', 'app'), env: {}, log: (l) => lines.push(l) });
      return { code, text: lines.join('\n') };
    };
    try {
      mkdirSync(join(dir, 'projects', 'app'), { recursive: true });
      // glob 14 pulling the patched minimatch is in the tree too: it holds only when run() hands the
      // advisory's ranges to the edge scan.
      writeFileSync(join(dir, 'pnpm-lock.yaml'), lockfile({ ...APP_TREE, 'glob@14.0.3': ['minimatch: 11.0.3'], 'minimatch@11.0.3': [] }));
      const holds = await runWith(DECLARED);
      expect(holds.code).toBe(0);
      expect(holds.text).toContain(`✓ unusable fix   ${MINIMATCH}`);
      expect(holds.text).toContain('[suppressions] verified 1 of 1');
      const stale = await runWith('glob@13.0.6 cannot use 11.0.1');
      expect(stale.code).toBe(1);
      expect(stale.text).toContain(`✗ RE-TEST        ${MINIMATCH}`);
      expect(stale.text).toContain('auditConfig.unusableFixConsumers');
      expect(stale.text).toContain('[suppressions] RE-TEST 1 of 1');
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

type FetchCall = [url: string, init: { headers: Record<string, string> }];

function fakeFetch(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push([url, init]);
    return { headers: new Headers(headers), json: async () => body, status };
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const offlineFetch = (async () => {
  throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
}) as unknown as typeof fetch;

describe('network lookups', () => {
  it('fetches the advisory, sending the token only when given', async () => {
    const f = fakeFetch(200, { ghsa_id: ID });
    expect(await createAdvisoryFetcher({ fetchImpl: f.impl })(ID)).toEqual({ advisory: { ghsa_id: ID }, ok: true });
    expect(f.calls[0]?.[0]).toBe(`https://api.github.com/advisories/${ID}`);
    expect(f.calls[0]?.[1].headers.Authorization).toBeUndefined();
    await createAdvisoryFetcher({ fetchImpl: f.impl, token: 't0k' })(ID);
    expect(f.calls[1]?.[1].headers.Authorization).toBe('Bearer t0k');
  });

  it('turns a rate limit, an unknown id and an outage into reasons, not advisories', async () => {
    expect(await createAdvisoryFetcher({ fetchImpl: fakeFetch(403, {}, { 'x-ratelimit-remaining': '0' }).impl })(ID)).toEqual({
      ok: false,
      reason: expect.stringMatching(/rate limit.*GITHUB_TOKEN/),
    });
    expect(await createAdvisoryFetcher({ fetchImpl: fakeFetch(404).impl })(ID)).toMatchObject({ ok: false });
    expect(await createAdvisoryFetcher({ fetchImpl: offlineFetch })(ID)).toEqual({ ok: false, reason: expect.stringContaining('ENOTFOUND') });
  });

  it('reads the packument: versions and publish times on 200, nothing published on 404, null otherwise', async () => {
    const body = { name: 'node-forge', time: FORGE_TIME, versions: { '1.4.0': {}, '1.4.1': {} } };
    expect(await createNpmPackumentFetcher({ fetchImpl: fakeFetch(200, body).impl })('node-forge')).toEqual({ time: FORGE_TIME, versions: body.versions });
    expect(await createNpmPackumentFetcher({ fetchImpl: fakeFetch(404).impl })('node-forge')).toEqual({ time: {}, versions: {} });
    expect(await createNpmPackumentFetcher({ fetchImpl: fakeFetch(503).impl })('node-forge')).toBeNull();
    expect(await createNpmPackumentFetcher({ fetchImpl: fakeFetch(200, { error: 'not a packument' }).impl })('node-forge')).toBeNull();
    expect(await createNpmPackumentFetcher({ fetchImpl: offlineFetch })('node-forge')).toBeNull();
  });

  it('asks for the full packument, the one that carries `time`, with the scope slash encoded', async () => {
    const f = fakeFetch(200, { versions: {} });
    await createNpmPackumentFetcher({ fetchImpl: f.impl })('@scope/pkg');
    expect(f.calls[0]?.[0]).toBe('https://registry.npmjs.org/@scope%2Fpkg');
    // The abbreviated install document (application/vnd.npm.install-v1+json) has no `time`.
    expect(f.calls[0]?.[1].headers.Accept).toBe('application/json');
  });
});

describe('minimumReleaseAgeOf', () => {
  it("reads a top-level minimumReleaseAge and falls back to pnpm 11's 24h default", () => {
    expect(minimumReleaseAgeOf('minimumReleaseAge: 10080')).toBe(10_080);
    expect(minimumReleaseAgeOf('packages:\n  - .\nminimumReleaseAge: 0 # off\n')).toBe(0);
    expect(minimumReleaseAgeOf('')).toBe(1440);
    expect(minimumReleaseAgeOf('# minimumReleaseAge: 5')).toBe(1440);
    expect(minimumReleaseAgeOf('nested:\n  minimumReleaseAge: 5')).toBe(1440);
  });

  it('reads the real workspace file the way pnpm does', () => {
    const text = readFileSync(join(WORKSPACE, 'pnpm-workspace.yaml'), 'utf8');
    // Independent oracle rather than a pinned 1440: a project that sets its own gate must not
    // turn this red. `minimumReleaseAgeExclude:` is a different key and must not be read as one.
    const line = text.split('\n').find((l) => l.startsWith('minimumReleaseAge:'));
    expect(minimumReleaseAgeOf(text)).toBe(line ? Number.parseInt(line.slice('minimumReleaseAge:'.length), 10) : 1440);
  });
});

describe('wiring', () => {
  const pkg = JSON.parse(readFileSync(join(TEMPLATE, 'package.json'), 'utf8'));

  it('runs in every check chain: after the audit in raw and fix, after the install in naf', () => {
    expect(pkg.scripts['check:raw']).toContain('pnpm audit && node scripts/check-suppressions.mjs &&');
    expect(pkg.scripts['check:fix']).toContain('pnpm audit --fix && node scripts/check-suppressions.mjs &&');
    // In vendor mode the CLI puts `check:vendor-freshness` right after the install.
    expect(pkg.scripts['check:naf']).toMatch(/pnpm install && (?:pnpm run check:vendor-freshness && )?node scripts\/check-suppressions\.mjs &&/);
  });

  it('gives the step its own kind in check.mjs, so an unverified run is not a plain tick', () => {
    // Whole code lines, anchored: prose in a comment does not start with `return {` or `if (`.
    // (Stripping block comments by regex does not work on this file: glob strings such as
    // 'projects/*' look like a comment opener and swallow real code.)
    const source = readFileSync(join(TEMPLATE, 'scripts', 'check.mjs'), 'utf8');
    expect(source).toMatch(/^\s+if \(c\.includes\('check-suppressions'\).*return \{ fatal: true, kind: 'suppressions', label: 'suppressions' \};$/m);
    expect(source).toMatch(/^\s+if \(step\.kind === 'suppressions'\) r\.suppressions = parseSuppressionSummary\(out\);$/m);
  });
});
