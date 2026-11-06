/**
 * Guards the "importing check.mjs must not start a check run" contract.
 *
 * `tests/unit/nuxt-builddir-isolation.test.ts` imports the runner to assert its pure
 * helpers. If the `isCliEntry()` gate ever regresses, that import kicks off the full
 * pipeline — install, build, boot a server — inside the test process. The suite then
 * never returns, and in CI that surfaces as a job timeout with no diagnosis at all.
 *
 * Run OUT OF PROCESS with a timeout, so a regression fails this one test in seconds
 * instead of hanging the runner it would otherwise take down with it.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const runnerUrl = JSON.stringify(pathToFileURL(join(import.meta.dirname, '..', '..', 'scripts', 'check.mjs')).href);

const runNode = (source: string, argv: string[] = []) => spawnSync(process.execPath, ['--input-type=module', '-e', source, ...argv], { encoding: 'utf8', timeout: 20_000 });

describe('check.mjs CLI entry gate', () => {
  it('importing the module exposes the pure helpers without starting a run', () => {
    const result = runNode(`const m = await import(${runnerUrl}); process.stdout.write(Object.keys(m).sort().join(','));`);

    expect(result.error, 'the import hung — isCliEntry() no longer prevents a run on import').toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    // Also pins the public surface `scripts/check.d.mts` declares. A helper added to
    // check.mjs but not to the .d.mts (or vice versa) shows up here.
    expect(result.stdout).toBe('buildGroups,isKillablePid,killTreePlan,killTreeWith,parseOverridesSummary,parseSuppressionSummary');
  });

  it('a missing argv[1] means "not the entry", not a hard exit', () => {
    // `node -e` has no script path. Exiting here instead of returning false would
    // kill every legitimate importer — including this test runner.
    const result = runNode(`await import(${runnerUrl}); process.stdout.write('alive');`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('alive');
  });

  it('refuses to report success when an EXISTING argv[1] cannot be resolved', () => {
    // The other direction: argv[1] is present but unresolvable. "Cannot tell" must
    // never become "everything passed" — a silent exit 0 here would be a green gate
    // that never ran.
    const result = runNode(`process.argv[1] = '/definitely/does/not/exist/check.mjs'; await import(${runnerUrl});`);

    expect(result.status, 'a bogus argv[1] must fail closed').toBe(1);
    expect(result.stderr).toMatch(/refusing to report success/);
  });
});
