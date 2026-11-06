#!/usr/bin/env node
/**
 * Release guard for the `@lenne.tech/ng-base` dependency (Kai's decision via the orchestrator, 2026-11-06).
 *
 * A released starter depends on ng-base as a real npm package, pinned EXACTLY (`"22.0.0"`): vendor mode clones the
 * tag `v<version>` of that pin, and a generated project must install from the registry. During local development the
 * dependency points at the ng-base working tree instead (`file:` + `dependenciesMeta.injected`), which must never
 * reach a release.
 *
 * Fails (exit 1) when, in strict mode, the spec is not an exact `x.y.z` version (`file:`, `link:`, `workspace:`, a
 * range) or `dependenciesMeta["@lenne.tech/ng-base"].injected` is set. Strict mode: `LT_RELEASE=true` (what
 * `pnpm run check:release` sets), `CI` set, or `--strict`. Otherwise it warns and exits 0, so `check` stays usable
 * while ng-base is developed side by side.
 *
 * Vendor mode (`src/core/VENDOR.md`): ng-base is project code, there is no dependency to pin, and the guard passes.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE = '@lenne.tech/ng-base';

/** The problems of a package.json for a release; empty when ng-base is an exact registry pin or vendored. */
export function ngBasePinProblems(pkg, { vendored = false } = {}) {
  const problems = [];
  if (vendored) {
    if (pkg.dependencies?.[PACKAGE] || pkg.devDependencies?.[PACKAGE]) {
      problems.push(`${PACKAGE} is vendored into src/core/ and must not be a dependency as well`);
    }
    return problems;
  }
  const spec = pkg.dependencies?.[PACKAGE];
  if (!spec) {
    problems.push(`${PACKAGE} is missing from "dependencies"`);
  } else if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec)) {
    problems.push(`${PACKAGE} is "${spec}", not an exact registry version (e.g. "22.0.0")`);
  }
  if (pkg.devDependencies?.[PACKAGE]) {
    problems.push(`${PACKAGE} belongs in "dependencies", not "devDependencies"`);
  }
  if (pkg.dependenciesMeta?.[PACKAGE]?.injected) {
    problems.push(`dependenciesMeta["${PACKAGE}"].injected is set (local development only)`);
  }
  return problems;
}

/** Strict when a release or CI run asks for it. */
export function isStrict(env = process.env, argv = process.argv) {
  return env.LT_RELEASE === 'true' || !!env.CI || argv.includes('--strict');
}

function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const vendored = existsSync(join(ROOT, 'src', 'core', 'VENDOR.md'));
  const problems = ngBasePinProblems(pkg, { vendored });
  if (problems.length === 0) {
    console.log(`check-ng-base-pin: ${vendored ? `${PACKAGE} vendored in src/core/` : `${PACKAGE} ${pkg.dependencies[PACKAGE]} (exact registry pin)`}`);
    return;
  }
  const strict = isStrict();
  const log = strict ? console.error : console.warn;
  log(`check-ng-base-pin: ${strict ? 'FAILED' : 'WARNING (development)'}`);
  for (const problem of problems) log(`  - ${problem}`);
  log(`  Release: publish ng-base first, then set "${PACKAGE}": "<version>", remove dependenciesMeta, run pnpm install.`);
  if (strict) process.exit(1);
}

function isCliEntry() {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main();
}
