/**
 * Guards the "packageManager as single source of truth" contract:
 *   - The manifest that governs installs pins the EXACT pnpm version with its
 *     +sha512 integrity hash, and engines.pnpm only gates the major.
 *   - The Dockerfile provisions that exact pnpm by deriving it from
 *     package.json (no corepack — Node >= 25 no longer ships it).
 *   - CI workflows read the version from package.json too: no `version:`
 *     input on pnpm/action-setup, no hardcoded `npm install -g pnpm@<n>`.
 *
 * Layout-agnostic: this template runs in TWO layouts and the pin lives in a
 * different manifest in each —
 *   - standalone starter: nuxt-base-template/package.json AND the repo-root
 *     package.json both carry the pin;
 *   - lt fullstack monorepo: projects/app/package.json has NO packageManager
 *     (pnpm workspaces: only the workspace root pins), the workspace-root
 *     package.json carries it. `projects/` itself has no manifest, so the
 *     ancestor search must SKIP manifest-less directories, never assume `..`.
 * The contract is therefore: every reachable manifest that HAS a
 * packageManager field pins exactly, at least ONE such manifest exists, and
 * every manifest's engines.pnpm gates the pinned major.
 *
 * The bug history: engines.pnpm '^11.0.0' alone lets corepack/CI provision an
 * uncontrolled pnpm; the day pnpm 12 releases, every build dies with
 * ERR_PNPM_UNSUPPORTED_ENGINE. A duplicate `version:` in CI silently drifts
 * from the pin. The functional block below proves the derive-chain actually
 * installs the pinned version (guarded: network + ~10MB, CI/opt-in only).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const templateRoot = join(import.meta.dirname, '..', '..');

const PIN_PATTERN = /^pnpm@\d+\.\d+\.\d+\+sha512\.[A-Za-z0-9]+$/;
const DERIVE_PATTERN = "packageManager.split('+')[0]";

interface Manifest {
  engines?: Record<string, string>;
  packageManager?: string;
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
}

/**
 * Nearest ancestor of `start` that carries a package.json. Standalone starter:
 * the repo root (one level up). lt-monorepo: the workspace root (two levels up
 * — `projects/` has no manifest and is skipped). Bounded walk, never throws.
 */
function findAncestorWithManifest(start: string): null | string {
  let dir = dirname(start);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

const ancestorRoot = findAncestorWithManifest(templateRoot);

const manifests: [name: string, dir: string][] = [
  ['template package.json', templateRoot],
  ...(ancestorRoot ? ([['ancestor-root package.json', ancestorRoot]] as [string, string][]) : []),
];

const pinningManifests = manifests.filter(([, dir]) => readManifest(dir).packageManager !== undefined);

describe('pnpm pin — governing manifest', () => {
  it('at least one reachable manifest pins pnpm via packageManager', () => {
    expect(pinningManifests.length).toBeGreaterThan(0);
  });
});

describe.each(pinningManifests)('%s — pnpm pin', (_name, dir) => {
  const pkg = readManifest(dir);

  it('pins an exact pnpm version with sha512 hash (no range)', () => {
    expect(pkg.packageManager).toMatch(PIN_PATTERN);
  });

  it('gates engines.pnpm on the pinned major only', () => {
    const major = pkg.packageManager?.match(/^pnpm@(\d+)\./)?.[1];
    expect(major).toBeDefined();
    expect(pkg.engines?.pnpm).toBe(`^${major}.0.0`);
  });
});

describe.each(manifests)('%s — engines gate', (_name, dir) => {
  const pkg = readManifest(dir);
  // Every manifest (pinning or not) that declares engines.pnpm must gate the
  // SAME major as the governing pin — a drifting sub-project gate would let a
  // future pnpm major slip into one layout but not the other.
  const governing = pinningManifests[0] ? readManifest(pinningManifests[0][1]) : undefined;
  const pinnedMajor = governing?.packageManager?.match(/^pnpm@(\d+)\./)?.[1];

  it.runIf(pkg.engines?.pnpm !== undefined)('engines.pnpm matches the governing pinned major', () => {
    expect(pinnedMajor).toBeDefined();
    expect(pkg.engines?.pnpm).toBe(`^${pinnedMajor}.0.0`);
  });
});

describe('Dockerfile — pnpm provisioning', () => {
  const dockerfile = join(templateRoot, 'Dockerfile');
  const content = readFileSync(dockerfile, 'utf8');

  it('derives pnpm from package.json (single source of truth)', () => {
    expect(content).toContain(DERIVE_PATTERN);
  });

  it('does not rely on corepack (gone in Node >= 25)', () => {
    expect(content).not.toContain('corepack enable');
  });
});

describe('GitHub workflows — pnpm version comes from package.json', () => {
  const workflowsDir = join(templateRoot, '.github', 'workflows');
  const workflows = readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f));

  it('finds at least one workflow', () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  it.each(workflows)('%s: no pnpm/action-setup step carries a version input', (file) => {
    const lines = readFileSync(join(workflowsDir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('pnpm/action-setup')) {
        return;
      }
      // Scan the step's `with:` block (until the next step starts).
      for (let j = i + 1; j < lines.length && !/^\s*-\s/.test(lines[j] ?? ''); j++) {
        expect(lines[j], `${file}:${j + 1} — remove 'version:' (read from packageManager)`).not.toMatch(/^\s*version:/);
      }
    });
  });

  it.each(workflows)('%s: no hardcoded `npm install -g pnpm@<version>`', (file) => {
    const content = readFileSync(join(workflowsDir, file), 'utf8');
    expect(content).not.toMatch(/npm install -g pnpm@\d/);
  });
});

/**
 * Functional proof: run the actual derive-line the Dockerfile uses, then
 * install the derived spec into a throwaway prefix and check the binary
 * reports exactly the pinned version. Runs from the GOVERNING manifest's
 * directory — the same manifest the Docker build context exposes as
 * ./package.json (template root standalone, workspace root in a monorepo).
 * Needs network + ~10MB, so it only runs in CI or when PIN_PROVISION_TEST=1
 * — never in local pre-push hooks.
 */
describe.runIf(Boolean(process.env.CI || process.env.PIN_PROVISION_TEST))('pnpm provisioning — functional', () => {
  const pinningRoot = pinningManifests[0]?.[1] ?? templateRoot;
  const pinned = readManifest(pinningRoot).packageManager ?? '';
  const pinnedSpec = pinned.split('+')[0]; // e.g. pnpm@11.13.1
  const pinnedVersion = pinnedSpec?.split('@')[1] ?? '';
  let prefix: string | undefined;

  afterAll(() => {
    if (prefix) {
      rmSync(prefix, { force: true, recursive: true });
    }
  });

  it('the Dockerfile derive-line resolves to the pinned spec and installs the pinned version', () => {
    // Exactly the command the Dockerfile runs (same quoting), from the directory
    // whose package.json governs the install (= the Docker build context root).
    const derived = execSync(`node -p "require('./package.json').packageManager.split('+')[0]"`, {
      cwd: pinningRoot,
      encoding: 'utf8',
    }).trim();
    expect(derived).toBe(pinnedSpec);

    prefix = mkdtempSync(join(tmpdir(), 'pnpm-pin-'));
    execSync(`npm install -g --prefix "${prefix}" "${derived}"`, { encoding: 'utf8', stdio: 'pipe' });

    // npm's global layout differs per platform: `<prefix>/bin/pnpm` on macOS/Linux,
    // `<prefix>\pnpm.cmd` directly in the prefix on Windows (no `bin` directory there).
    // Accept either, but exactly one: the test must run the pnpm it just installed, never
    // one found on PATH. Same fix as @lenne.tech/nuxt-extensions' pin test.
    const launchers = [join(prefix, 'bin', 'pnpm'), join(prefix, 'pnpm.cmd')].filter((path) => existsSync(path));
    expect(launchers).toHaveLength(1);
    // Ask from the empty prefix, never from a project directory: pnpm 11 reports the
    // `packageManager` pin of the directory it runs in, not its own version, so from here a
    // wrongly installed pnpm@11.14.0 printed the template's 11.28.5 and the test passed.
    const version = execSync(`"${launchers[0]}" --version`, { cwd: prefix, encoding: 'utf8' }).trim();
    expect(version).toBe(pinnedVersion);
  }, 180_000);
});
