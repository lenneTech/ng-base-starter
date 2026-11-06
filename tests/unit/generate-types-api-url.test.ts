/**
 * DEV-2802 — `generate-types` must never guess an API URL, and must never
 * report success when it did not succeed.
 *
 * The old `openapi-ts.config.ts` fell back to `http://127.0.0.1:3000` whenever
 * `NG_API_URL` was unset. On a machine running several lt projects in
 * parallel that port belongs to *some other* project, so the generator wrote
 * `types.gen.ts` / `sdk.gen.ts` from a foreign contract and still exited 0.
 *
 * These tests pin the replacement contract:
 *   1. an explicit `NG_API_URL` wins,
 *   2. `<root>/.lt-dev/.env` supplies the URL as a fallback — and its
 *      `NODE_EXTRA_CA_CERTS` on BOTH paths, because the Caddy trust anchor is
 *      needed regardless of where the URL came from,
 *   3. otherwise the run FAILS — no default, ever,
 *   4. a URL that provably belongs to a *different* `lt dev` project fails too,
 *      and every branch that cannot check says so instead of going quiet,
 *   5. the wrapper propagates the generator's exit code.
 *
 * Assertions are behavioural. An earlier revision pinned points 3 and 5 with
 * regexes over the source; mutation testing showed both passing while the
 * behaviour was reverted (a `const APP_DIR = process.cwd()` keeps the call site
 * reading `cwd: APP_DIR`, and a default on a different port is still a default).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { redactUrl, runGenerateTypes } from '../../scripts/generate-types.mjs';
import { findLtDevEnvFile, findOwnRegistration, OPENAPI_PATH, parseEnvFile, readLtDevRegistrations, resolveApiInput, withOpenApiPath } from '../../scripts/resolve-api-url.mjs';

const APP_DIR = join(import.meta.dirname, '..', '..');
const ROOT = '/Users/dev/code/my-app-2';
const CWD = `${ROOT}/projects/app`;
const HOME = '/Users/dev';
const REGISTRY_PATH = `${HOME}/.lenneTech/projects.json`;

/** Registry with two projects whose paths are string prefixes of one another. */
const REGISTRY = JSON.stringify({
  projects: {
    'my-app': {
      path: '/Users/dev/code/my-app',
      subdomains: { api: 'api.my-app.localhost', app: 'my-app.localhost' },
    },
    'my-app-2': {
      path: ROOT,
      subdomains: { api: 'api.my-app-2.localhost', app: 'my-app-2.localhost' },
    },
  },
});

const LT_DEV_ENV = [
  '# Managed by `lt dev up` — do NOT edit, will be overwritten.',
  'NG_API_URL=https://api.my-app-2.localhost',
  'NG_PUBLIC_API_URL=https://api.my-app-2.localhost',
  'LT_DEV_ACTIVE=true',
  'DATABASE_URL=postgresql://my-app-2:my-app-2@localhost:5432/my-app-2',
  'NSC__MONGOOSE__URI=mongodb://127.0.0.1/my-app-2',
  'NODE_EXTRA_CA_CERTS=/Users/dev/Library/Application Support/Caddy/pki/authorities/local/root.crt',
].join('\n');

/** Build a `readTextFile` over an in-memory file map. */
function fakeFs(files: Record<string, string>) {
  return (filePath: string): string | undefined => files[filePath];
}

/** Deps with sensible defaults; every field overridable per test. */
function deps(overrides: Partial<Parameters<typeof resolveApiInput>[0]> = {}) {
  return {
    cwd: CWD,
    env: {} as Record<string, string | undefined>,
    homeDir: HOME,
    readTextFile: fakeFs({ [REGISTRY_PATH]: REGISTRY }),
    ...overrides,
  };
}

/** Capture the message of a thrown error without swallowing a non-throw. */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the call to throw, but it returned');
}

describe('withOpenApiPath', () => {
  it('appends the OpenAPI path when missing', () => {
    expect(withOpenApiPath('https://api.my-app-2.localhost')).toBe(`https://api.my-app-2.localhost${OPENAPI_PATH}`);
  });

  it('collapses a trailing slash instead of doubling it', () => {
    expect(withOpenApiPath('https://api.my-app-2.localhost/')).toBe(`https://api.my-app-2.localhost${OPENAPI_PATH}`);
  });

  it('keeps a URL that already carries the path', () => {
    const full = `https://api.my-app-2.localhost${OPENAPI_PATH}`;
    expect(withOpenApiPath(full)).toBe(full);
  });

  it('appends BEFORE the query string instead of after it', () => {
    // A plain string concat produced `…/?v=1/api-docs-json`, a URL that fetches nothing.
    expect(withOpenApiPath('https://api.my-app-2.localhost/?v=1')).toBe(`https://api.my-app-2.localhost${OPENAPI_PATH}?v=1`);
  });

  it('does not treat a HOST that merely contains the token as an already-complete URL', () => {
    // A substring check matched `https://api-docs-json.example.test` and left it alone.
    expect(withOpenApiPath('https://api-docs-json.example.test')).toBe(`https://api-docs-json.example.test${OPENAPI_PATH}`);
  });

  it('appends under a base path instead of replacing it', () => {
    expect(withOpenApiPath('https://gw.example.test/backend')).toBe(`https://gw.example.test/backend${OPENAPI_PATH}`);
  });
});

describe('parseEnvFile', () => {
  it('reads exactly the KEY=VALUE lines and ignores comments', () => {
    expect(Object.keys(parseEnvFile(LT_DEV_ENV)).sort()).toEqual(['DATABASE_URL', 'LT_DEV_ACTIVE', 'NG_API_URL', 'NG_PUBLIC_API_URL', 'NODE_EXTRA_CA_CERTS', 'NSC__MONGOOSE__URI']);
  });

  it('keeps values containing spaces intact', () => {
    expect(parseEnvFile(LT_DEV_ENV).NODE_EXTRA_CA_CERTS).toBe('/Users/dev/Library/Application Support/Caddy/pki/authorities/local/root.crt');
  });

  it('keeps values containing equals signs intact', () => {
    // A naive `split('=')[1]` truncates connection strings and tokens.
    expect(parseEnvFile('SOME_URL=https://host/path?a=1&b=2').SOME_URL).toBe('https://host/path?a=1&b=2');
  });

  it('ignores lowercase keys and blank values are preserved', () => {
    const vars = parseEnvFile(['lower_case=nope', 'EMPTY=', 'OK=yes'].join('\n'));
    expect(vars).toEqual({ EMPTY: '', OK: 'yes' });
  });

  it('handles CRLF line endings', () => {
    expect(parseEnvFile('A=1\r\nB=2').B).toBe('2');
  });
});

describe('findLtDevEnvFile', () => {
  const envAtRoot = fakeFs({ [`${ROOT}/.lt-dev/.env`]: LT_DEV_ENV });

  it('finds the file by walking up from projects/app', () => {
    expect(findLtDevEnvFile(CWD, envAtRoot)?.path).toBe(`${ROOT}/.lt-dev/.env`);
  });

  it('walks at most six directories', () => {
    const deep = `${ROOT}/a/b/c/d/e/projects/app`;
    expect(findLtDevEnvFile(deep, envAtRoot)).toBeNull();
  });

  it('terminates at the filesystem root instead of looping', () => {
    expect(findLtDevEnvFile('/', fakeFs({}))).toBeNull();
  });

  it('never probes above the stopAt boundary', () => {
    // A bridge file in a PARENT of the repo (e.g. ~/code) must not be adopted.
    const envAboveRoot = fakeFs({ '/Users/dev/code/.lt-dev/.env': LT_DEV_ENV });
    expect(findLtDevEnvFile(CWD, envAboveRoot, ROOT)).toBeNull();
    expect(findLtDevEnvFile(CWD, envAboveRoot)?.path).toBe('/Users/dev/code/.lt-dev/.env');
  });

  it('normalises Windows separators so the walk works there too', () => {
    const win = fakeFs({ 'C:/repo/.lt-dev/.env': LT_DEV_ENV });
    expect(findLtDevEnvFile('C:\\repo\\projects\\app', win)?.path).toBe('C:/repo/.lt-dev/.env');
  });
});

describe('findOwnRegistration', () => {
  const registrations = readLtDevRegistrations(HOME, fakeFs({ [REGISTRY_PATH]: REGISTRY }));

  it('matches the project the cwd lives in', () => {
    expect(findOwnRegistration(registrations, CWD)?.slug).toBe('my-app-2');
  });

  it('does not mistake a path that is only a STRING prefix for the owner', () => {
    // '/Users/dev/code/my-app' is a string prefix of '/Users/dev/code/my-app-2'.
    // Matching without a separator boundary would attribute my-app-2's cwd to my-app.
    expect(findOwnRegistration(registrations, CWD)?.slug).not.toBe('my-app');
  });

  it('matches the OTHER project too — the boundary rule is not a one-way filter', () => {
    expect(findOwnRegistration(registrations, '/Users/dev/code/my-app/projects/app')?.slug).toBe('my-app');
  });

  it('matches an exact repo root, not only a subdirectory', () => {
    expect(findOwnRegistration(registrations, ROOT)?.slug).toBe('my-app-2');
  });

  it('prefers the longest match so a nested registration beats its parent', () => {
    const nested = [
      { apiHost: 'api.outer.localhost', path: '/Users/dev/code', slug: 'outer' },
      { apiHost: 'api.inner.localhost', path: '/Users/dev/code/inner', slug: 'inner' },
    ];
    expect(findOwnRegistration(nested, '/Users/dev/code/inner/projects/app')?.slug).toBe('inner');
    expect(findOwnRegistration([...nested].reverse(), '/Users/dev/code/inner/projects/app')?.slug).toBe('inner');
  });

  it('tolerates a trailing slash on the cwd and on the registry path', () => {
    expect(findOwnRegistration(registrations, `${CWD}/`)?.slug).toBe('my-app-2');
    expect(findOwnRegistration([{ apiHost: 'api.x.localhost', path: `${ROOT}/`, slug: 'x' }], CWD)?.slug).toBe('x');
  });

  it('returns null for a cwd outside every registered project', () => {
    expect(findOwnRegistration(registrations, '/Users/dev/code/unrelated/app')).toBeNull();
  });

  it('treats a missing or malformed registry as "not registered"', () => {
    expect(readLtDevRegistrations(HOME, fakeFs({}))).toEqual([]);
    expect(readLtDevRegistrations(HOME, fakeFs({ [REGISTRY_PATH]: 'not json' }))).toEqual([]);
    expect(readLtDevRegistrations(HOME, fakeFs({ [REGISTRY_PATH]: '{"projects":"nope"}' }))).toEqual([]);
  });

  it('skips registry entries without a usable path instead of crashing', () => {
    const broken = JSON.stringify({ projects: { bad: { subdomains: { api: 'api.bad.localhost' } }, good: { path: '/p', subdomains: { api: 'api.good.localhost' } } } });
    expect(readLtDevRegistrations(HOME, fakeFs({ [REGISTRY_PATH]: broken })).map((r) => r.slug)).toEqual(['good']);
  });

  it('maps a missing api subdomain to apiHost null rather than dropping the entry', () => {
    const noApi = JSON.stringify({ projects: { app_only: { path: '/p', subdomains: { app: 'app-only.localhost' } } } });
    expect(readLtDevRegistrations(HOME, fakeFs({ [REGISTRY_PATH]: noApi }))).toEqual([{ apiHost: null, path: '/p', slug: 'app_only' }]);
  });
});

describe('resolveApiInput — resolution order', () => {
  it('uses an explicit NG_API_URL', () => {
    const result = resolveApiInput(deps({ env: { NG_API_URL: 'https://api.my-app-2.localhost' } }));
    expect(result.url).toBe('https://api.my-app-2.localhost');
    expect(result.source).toBe('env');
    expect(result.input).toBe(`https://api.my-app-2.localhost${OPENAPI_PATH}`);
    expect(result.slug).toBe('my-app-2');
    expect(result.warnings).toEqual([]);
  });

  it('falls back to <root>/.lt-dev/.env, found by walking UP from projects/app', () => {
    const result = resolveApiInput(deps({ readTextFile: fakeFs({ [`${ROOT}/.lt-dev/.env`]: LT_DEV_ENV, [REGISTRY_PATH]: REGISTRY }) }));
    expect(result.url).toBe('https://api.my-app-2.localhost');
    expect(result.source).toBe('lt-dev');
    expect(result.slug).toBe('my-app-2');
    expect(result.input).toBe(`https://api.my-app-2.localhost${OPENAPI_PATH}`);
  });

  it('carries NODE_EXTRA_CA_CERTS out of .lt-dev/.env so the child process trusts the Caddy CA', () => {
    // Node reads NODE_EXTRA_CA_CERTS at STARTUP — setting process.env inside the
    // openapi-ts config would be too late, so the wrapper must pass it to a child.
    const result = resolveApiInput(deps({ readTextFile: fakeFs({ [`${ROOT}/.lt-dev/.env`]: LT_DEV_ENV, [REGISTRY_PATH]: REGISTRY }) }));
    expect(result.ltDevEnv.NODE_EXTRA_CA_CERTS).toMatch(/root\.crt$/);
  });

  it('ALSO carries it when the URL came from the shell — the CA is needed either way', () => {
    // Coupling the two broke the documented escape hatch: `NG_API_URL=… pnpm run
    // generate-types` against an lt-dev HTTPS host died with UNABLE_TO_GET_ISSUER_CERT_LOCALLY.
    const result = resolveApiInput(
      deps({
        env: { NG_API_URL: 'https://api.my-app-2.localhost' },
        readTextFile: fakeFs({ [`${ROOT}/.lt-dev/.env`]: LT_DEV_ENV, [REGISTRY_PATH]: REGISTRY }),
      }),
    );
    expect(result.source).toBe('env');
    expect(result.ltDevEnv.NODE_EXTRA_CA_CERTS).toMatch(/root\.crt$/);
  });

  it('reports an empty ltDevEnv when there is no bridge file at all', () => {
    expect(resolveApiInput(deps({ env: { NG_API_URL: 'https://api.my-app-2.localhost' } })).ltDevEnv).toEqual({});
  });

  it('prefers the shell env over the .lt-dev/.env file', () => {
    const result = resolveApiInput(
      deps({
        env: { NG_API_URL: 'https://api.my-app-2-test.localhost' },
        readTextFile: fakeFs({ [`${ROOT}/.lt-dev/.env`]: LT_DEV_ENV, [REGISTRY_PATH]: REGISTRY }),
      }),
    );
    expect(result.url).toBe('https://api.my-app-2-test.localhost');
    expect(result.source).toBe('env');
  });

  it('ignores an empty NG_API_URL instead of generating against ""', () => {
    expect(() => resolveApiInput(deps({ env: { NG_API_URL: '   ' } }))).toThrow(/NG_API_URL is not set/);
  });

  it('never adopts a bridge file from ABOVE the registered repo root', () => {
    // ~/code/.lt-dev/.env belongs to no project; adopting it would hand over
    // both the URL and the child environment.
    const readTextFile = fakeFs({ '/Users/dev/code/.lt-dev/.env': LT_DEV_ENV, [REGISTRY_PATH]: REGISTRY });
    expect(() => resolveApiInput(deps({ readTextFile }))).toThrow(/NG_API_URL is not set/);
  });
});

describe('resolveApiInput — no silent fallback (the DEV-2802 regression)', () => {
  it('throws instead of guessing a port when the project is registered', () => {
    const message = messageOf(() => resolveApiInput(deps()));
    expect(message).not.toMatch(/127\.0\.0\.1:3000/);
    expect(message).toContain('lt dev up');
    expect(message).toContain('my-app-2');
  });

  it('throws with a NG_API_URL hint when the project is NOT registered', () => {
    const message = messageOf(() => resolveApiInput(deps({ cwd: '/Users/dev/code/unrelated/app' })));
    expect(message).toContain('NG_API_URL');
    expect(message).not.toMatch(/127\.0\.0\.1:3000/);
  });

  it('says the .env file is NOT read, because that is the trap the message walks into', () => {
    expect(messageOf(() => resolveApiInput(deps()))).toMatch(/\.env\s*\n?file is NOT read|file is NOT read/);
  });

  it('distinguishes "no bridge file" from "bridge file without the key"', () => {
    const withoutKey = 'LT_DEV_ACTIVE=true\nNODE_EXTRA_CA_CERTS=/ca.crt';
    const message = messageOf(() => resolveApiInput(deps({ readTextFile: fakeFs({ [`${ROOT}/.lt-dev/.env`]: withoutKey, [REGISTRY_PATH]: REGISTRY }) })));
    expect(message).toContain(`${ROOT}/.lt-dev/.env`);
    expect(message).toContain('does not define it');
    expect(message).not.toContain('no .lt-dev/.env was found');
  });

  it('rejects a malformed URL instead of passing it to the generator', () => {
    expect(() => resolveApiInput(deps({ env: { NG_API_URL: 'not-a-url' } }))).toThrow(/NG_API_URL is not a valid URL/);
  });
});

describe('resolveApiInput — foreign project guard', () => {
  it('rejects a URL belonging to a DIFFERENT registered lt dev project', () => {
    const message = messageOf(() => resolveApiInput(deps({ env: { NG_API_URL: 'https://api.my-app.localhost' } })));
    expect(message).toContain('my-app-2');
    expect(message).toContain('belongs to the "my-app" project');
  });

  it('accepts the `lt dev test` twin host of the OWN project', () => {
    const result = resolveApiInput(deps({ env: { NG_API_URL: 'https://api.my-app-2-test.localhost' } }));
    expect(result.url).toBe('https://api.my-app-2-test.localhost');
    expect(result.warnings).toEqual([]);
  });

  it('rejects the test twin of a FOREIGN project', () => {
    expect(() => resolveApiInput(deps({ env: { NG_API_URL: 'https://api.my-app-test.localhost' } }))).toThrow(/belongs to the "my-app" project/);
  });

  it('lets a REAL registration outrank the synthesized -test twin', () => {
    // Own slug my-app-2 synthesizes api.my-app-2-test.localhost. If a project is
    // actually registered under that name, checking the twin first accepted it
    // with no warning at all — the original DEV-2802 signature.
    const registry = JSON.stringify({
      projects: {
        'my-app-2': { path: ROOT, subdomains: { api: 'api.my-app-2.localhost' } },
        'my-app-2-test': { path: '/Users/dev/code/my-app-2-test', subdomains: { api: 'api.my-app-2-test.localhost' } },
      },
    });
    expect(() => resolveApiInput(deps({ env: { NG_API_URL: 'https://api.my-app-2-test.localhost' }, readTextFile: fakeFs({ [REGISTRY_PATH]: registry }) }))).toThrow(
      /belongs to the "my-app-2-test" project/,
    );
  });

  it('canonicalises a fully-qualified trailing dot, which Caddy answers identically', () => {
    expect(() => resolveApiInput(deps({ env: { NG_API_URL: 'https://api.my-app.localhost./' } }))).toThrow(/belongs to the "my-app" project/);
  });

  it('canonicalises an upper-cased registry host', () => {
    const registry = JSON.stringify({
      projects: {
        'my-app-2': { path: ROOT, subdomains: { api: 'api.my-app-2.localhost' } },
        other: { path: '/Users/dev/code/other', subdomains: { api: 'API.OTHER.LOCALHOST' } },
      },
    });
    expect(() => resolveApiInput(deps({ env: { NG_API_URL: 'https://api.other.localhost' }, readTextFile: fakeFs({ [REGISTRY_PATH]: registry }) }))).toThrow(
      /belongs to the "other" project/,
    );
  });

  it('allows an unrelated explicit host but warns when the project is registered', () => {
    const result = resolveApiInput(deps({ env: { NG_API_URL: 'http://127.0.0.1:3000' } }));
    expect(result.url).toBe('http://127.0.0.1:3000');
    expect(result.warnings.join('\n')).toContain('api.my-app-2.localhost');
    expect(result.warnings.join('\n')).toContain('NG_API_URL was set explicitly');
  });

  it('does not claim "set explicitly" when the URL came from the bridge', () => {
    const bridge = 'NG_API_URL=http://127.0.0.1:3000';
    const result = resolveApiInput(deps({ readTextFile: fakeFs({ [`${ROOT}/.lt-dev/.env`]: bridge, [REGISTRY_PATH]: REGISTRY }) }));
    expect(result.warnings.join('\n')).toContain('.lt-dev/.env bridge');
  });

  it('does not warn for an explicit host when no lt dev registration exists (CI, Docker)', () => {
    const result = resolveApiInput(deps({ cwd: '/builds/my-app/projects/app', env: { NG_API_URL: 'http://localhost:3000' }, readTextFile: fakeFs({}) }));
    expect(result.url).toBe('http://localhost:3000');
    expect(result.warnings).toEqual([]);
    expect(result.slug).toBeNull();
  });
});

describe('resolveApiInput — the guard says when it is INACTIVE', () => {
  it('warns when a populated registry claims no owner for this checkout', () => {
    // Reachable through a case-differing path on a case-insensitive volume or a
    // symlinked/moved checkout. Silence there is what let a foreign host through.
    const result = resolveApiInput(deps({ cwd: '/Users/dev/code/LT-CRM-2/projects/app', env: { NG_API_URL: 'https://staging.example.test' } }));
    expect(result.warnings.join('\n')).toContain('INACTIVE');
  });

  it('still refuses a provably foreign host even when the checkout is unclaimed', () => {
    expect(() => resolveApiInput(deps({ cwd: '/Users/dev/code/LT-CRM-2/projects/app', env: { NG_API_URL: 'https://api.my-app.localhost' } }))).toThrow(
      /belongs to the "my-app" project/,
    );
  });

  it('warns when the own registration has no API host at all', () => {
    const registry = JSON.stringify({ projects: { 'my-app-2': { path: ROOT, subdomains: { app: 'my-app-2.localhost' } } } });
    const result = resolveApiInput(deps({ env: { NG_API_URL: 'https://api.my-app.localhost' }, readTextFile: fakeFs({ [REGISTRY_PATH]: registry }) }));
    expect(result.warnings.join('\n')).toContain('INACTIVE');
  });

  it('trusts a bridge file inside an unclaimed checkout, but reports it', () => {
    const result = resolveApiInput(
      deps({ cwd: '/Users/dev/code/LT-CRM-2/projects/app', readTextFile: fakeFs({ '/Users/dev/code/LT-CRM-2/.lt-dev/.env': LT_DEV_ENV, [REGISTRY_PATH]: REGISTRY }) }),
    );
    expect(result.url).toBe('https://api.my-app-2.localhost');
    expect(result.warnings.join('\n')).toContain('INACTIVE');
  });

  it('compares the HOSTNAME, so the port is not part of a project identity (documented limit)', () => {
    // `lt dev` separates projects by subdomain, never by port, so any port on the
    // own host counts as own. Pinned so the decision is deliberate, not accidental.
    const registry = JSON.stringify({ projects: { 'my-app-2': { path: ROOT, subdomains: { api: 'localhost' } } } });
    const result = resolveApiInput(deps({ env: { NG_API_URL: 'http://localhost:3999' }, readTextFile: fakeFs({ [REGISTRY_PATH]: registry }) }));
    expect(result.warnings).toEqual([]);
  });

  it('refuses rather than guesses when two registered projects share a hostname', () => {
    const registry = JSON.stringify({
      projects: {
        'my-app-2': { path: ROOT, subdomains: { api: 'localhost' } },
        other: { path: '/Users/dev/code/other', subdomains: { api: 'localhost' } },
      },
    });
    expect(() => resolveApiInput(deps({ env: { NG_API_URL: 'http://localhost:3999' }, readTextFile: fakeFs({ [REGISTRY_PATH]: registry }) }))).toThrow(
      /belongs to the "other" project/,
    );
  });
});

describe('runGenerateTypes — the wrapper never reports success it did not have', () => {
  const CA = '/Users/dev/ca.crt';
  // Fixtures are anchored at the REAL app dir so the generator entry exists;
  // the bridge and the registration are faked at that same directory, which
  // keeps this block free of any assumption about the repo layout above it.
  const BRIDGE = ['NG_API_URL=https://api.my-app-2.localhost', `NODE_EXTRA_CA_CERTS=${CA}`, 'DATABASE_URL=postgresql://secret@localhost/db'].join('\n');
  // The resolver asks for `${toPosix(cwd)}/.lt-dev/.env` on every platform, so the fake
  // file must be keyed the same way. A native `join` gives `D:\...\.lt-dev\.env` on
  // Windows, the lookup misses, and every wrapper test fails before it spawns anything.
  const BRIDGE_PATH = `${APP_DIR.replace(/\\/g, '/')}/.lt-dev/.env`;
  const APP_REGISTRY = JSON.stringify({ projects: { 'my-app-2': { path: APP_DIR, subdomains: { api: 'api.my-app-2.localhost' } } } });

  /** A spawn double whose recorded arguments stay typed. */
  function spawnDouble(result: { error?: Error; signal?: null | string; status: null | number } = { status: 0 }) {
    return vi.fn((_command: string, _args: string[], _options: { cwd: string; env: Record<string, string | undefined> }) => result);
  }

  /** Wrapper deps pointing at the REAL app dir (so the generator entry exists) with fake I/O. */
  function wrapperDeps(overrides: Partial<Parameters<typeof runGenerateTypes>[0]> = {}) {
    const messages: string[] = [];
    const base = {
      appDir: APP_DIR,
      argv: [] as string[],
      env: {} as Record<string, string | undefined>,
      homeDir: HOME,
      log: {
        error: (m: string) => messages.push(m),
        log: (m: string) => messages.push(m),
        warn: (m: string) => messages.push(m),
      },
      readTextFile: fakeFs({ [BRIDGE_PATH]: BRIDGE, [REGISTRY_PATH]: APP_REGISTRY }),
      spawn: spawnDouble(),
    };
    return { deps: { ...base, ...overrides }, messages };
  }

  it('propagates a non-zero generator exit code', () => {
    const { deps: d } = wrapperDeps({ spawn: () => ({ status: 2 }) });
    expect(runGenerateTypes(d)).toBe(2);
  });

  it('returns 0 only when the generator returned 0', () => {
    const { deps: d } = wrapperDeps();
    expect(runGenerateTypes(d)).toBe(0);
  });

  it('fails when the child reports neither a status nor a signal', () => {
    const { deps: d } = wrapperDeps({ spawn: () => ({ status: null }) });
    expect(runGenerateTypes(d)).toBe(1);
  });

  it('maps a signalled child to 128 + signum instead of collapsing it to 1', () => {
    const { deps: d } = wrapperDeps({ spawn: () => ({ signal: 'SIGINT', status: null }) });
    expect(runGenerateTypes(d)).toBe(130);
  });

  it('fails when the child could not be started at all', () => {
    const { deps: d, messages } = wrapperDeps({ spawn: () => ({ error: new Error('ENOENT'), status: null }) });
    expect(runGenerateTypes(d)).toBe(1);
    expect(messages.join('\n')).toContain('could not start the generator');
  });

  it('fails when the URL cannot be resolved, without spawning anything', () => {
    const spawn = spawnDouble();
    const { deps: d } = wrapperDeps({ readTextFile: fakeFs({}), spawn });
    expect(runGenerateTypes(d)).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('runs the generator through the current Node binary, not a .bin shim', () => {
    const spawn = spawnDouble();
    const { deps: d } = wrapperDeps({ spawn });
    runGenerateTypes(d);
    expect(spawn.mock.calls[0][0]).toBe(process.execPath);
    expect(spawn.mock.calls[0][1][0]).toContain(join('@hey-api', 'openapi-ts', 'bin', 'run.js'));
  });

  it('forwards extra CLI arguments untouched', () => {
    const spawn = spawnDouble();
    const { deps: d } = wrapperDeps({ argv: ['--dry-run', '--silent'], spawn });
    runGenerateTypes(d);
    expect(spawn.mock.calls[0][1].slice(1)).toEqual(['--dry-run', '--silent']);
  });

  it('refuses an argument that would override the validated input URL', () => {
    const spawn = spawnDouble();
    const { deps: d, messages } = wrapperDeps({ argv: ['-i', 'http://127.0.0.1:59999/api-docs-json'], spawn });
    expect(runGenerateTypes(d)).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(messages.join('\n')).toContain('overrides the API URL');
  });

  it('refuses the --input=… form as well', () => {
    const { deps: d } = wrapperDeps({ argv: ['--input=http://elsewhere.test/api-docs-json'] });
    expect(runGenerateTypes(d)).toBe(1);
  });

  it('hands the resolved URL and the Caddy CA to the child', () => {
    const spawn = spawnDouble();
    const { deps: d } = wrapperDeps({ spawn });
    runGenerateTypes(d);
    const childEnv = spawn.mock.calls[0]![2].env;
    expect(childEnv.NG_API_URL).toBe('https://api.my-app-2.localhost');
    expect(childEnv.NODE_EXTRA_CA_CERTS).toBe(CA);
  });

  it('does NOT forward unrelated bridge variables into the generator and its post-processors', () => {
    const spawn = spawnDouble();
    const { deps: d } = wrapperDeps({ spawn });
    runGenerateTypes(d);
    const childEnv = spawn.mock.calls[0]![2].env;
    expect(childEnv.DATABASE_URL).toBeUndefined();
  });

  it('lets the shell env win over the bridge file', () => {
    const spawn = spawnDouble();
    const { deps: d } = wrapperDeps({ env: { NODE_EXTRA_CA_CERTS: '/shell.crt' }, spawn });
    runGenerateTypes(d);
    const childEnv = spawn.mock.calls[0]![2].env;
    expect(childEnv.NODE_EXTRA_CA_CERTS).toBe('/shell.crt');
  });

  it('runs the generator in the app directory, not in the caller cwd', () => {
    const spawn = spawnDouble();
    const { deps: d } = wrapperDeps({ spawn });
    runGenerateTypes(d);
    expect(spawn.mock.calls[0]![2].cwd).toBe(APP_DIR);
  });

  it('resolves from its OWN directory — a sibling checkout must not decide the URL', () => {
    // The behavioural counterpart to commit 128adb2: the bridge file is looked up
    // relative to appDir. Only the app's own bridge is visible here, so a run
    // started from anywhere else still resolves this project's URL.
    const spawn = spawnDouble();
    const { deps: d } = wrapperDeps({ spawn });
    runGenerateTypes(d);
    const childEnv = spawn.mock.calls[0]![2].env;
    expect(childEnv.NG_API_URL).toBe('https://api.my-app-2.localhost');
  });

  it('defaults its app directory to the SCRIPT location, not to the process cwd', () => {
    // Exercises the module-level default, which the tests above bypass by passing
    // `appDir` explicitly — and which is captured at IMPORT time, so changing the
    // cwd inside this process cannot reach it. A child started from an unrelated
    // directory is the sibling-checkout scenario in miniature: with
    // `APP_DIR = process.cwd()` the module resolves against the wrong project,
    // finds neither the bridge nor the generator, and prints nothing.
    const probeDir = mkdtempSync(join(tmpdir(), 'gt-probe-'));
    const probe = join(probeDir, 'probe.mjs');
    writeFileSync(
      probe,
      [
        `const mod = await import(${JSON.stringify(pathToFileURL(join(APP_DIR, 'scripts', 'generate-types.mjs')).href)});`,
        `const bridgePath = ${JSON.stringify(BRIDGE_PATH)};`,
        'const code = mod.runGenerateTypes({',
        '  argv: [], env: {}, homeDir: "/nonexistent-home-for-this-probe",',
        '  log: { error() {}, log() {}, warn() {} },',
        '  readTextFile: (p) => (p === bridgePath ? "NG_API_URL=https://api.probe.test" : undefined),',
        '  spawn: (_c, _a, o) => { console.log("CWD=" + o.cwd); return { status: 0 }; },',
        '});',
        'if (code !== 0) console.log("EXIT=" + code);',
      ].join('\n'),
    );

    const child = spawnSync(process.execPath, [probe], { cwd: probeDir, encoding: 'utf8' });
    rmSync(probeDir, { force: true, recursive: true });

    expect(child.stdout.trim()).toBe(`CWD=${APP_DIR}`);
  });

  it('prints the resolved URL and every warning', () => {
    const { deps: d, messages } = wrapperDeps({ env: { NG_API_URL: 'https://staging.example.test' } });
    runGenerateTypes(d);
    const output = messages.join('\n');
    expect(output).toContain('https://staging.example.test/api-docs-json');
    expect(output).toContain('WARNING');
  });

  it('never echoes credentials embedded in the URL', () => {
    const { deps: d, messages } = wrapperDeps({ env: { NG_API_URL: 'https://user:s3cr3t@staging.example.test' } });
    runGenerateTypes(d);
    expect(messages.join('\n')).not.toContain('s3cr3t');
  });
});

describe('redactUrl', () => {
  it('strips userinfo', () => {
    expect(redactUrl('https://user:pw@host.test/x')).toBe('https://host.test/x');
  });

  it('leaves a credential-free URL byte-identical', () => {
    expect(redactUrl('https://host.test/x')).toBe('https://host.test/x');
  });

  it('passes a non-URL through unchanged instead of throwing', () => {
    expect(redactUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('wiring — the fix is actually reachable from pnpm run generate-types', () => {
  it('the openapi-ts config refuses to load without NG_API_URL', async () => {
    // Behavioural, not a grep: a default on ANY port (or a template-built one)
    // must fail this, and a comment mentioning a port must not.
    vi.resetModules();
    vi.stubEnv('NG_API_URL', '');
    await expect(import('../../openapi-ts.config')).rejects.toThrow(/deliberately no default/);
    vi.unstubAllEnvs();
  });

  it('the openapi-ts config generates from the configured base URL + the OpenAPI path', async () => {
    vi.resetModules();
    vi.stubEnv('NG_API_URL', 'https://api.my-app-2.localhost');
    const config = await (await import('../../openapi-ts.config')).default;
    expect(config.input).toBe(`https://api.my-app-2.localhost${OPENAPI_PATH}`);
    vi.unstubAllEnvs();
  });

  it('the generate-types script routes through the guarding wrapper', async () => {
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(join(APP_DIR, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['generate-types']).toMatch(/^node .*scripts\/generate-types\.mjs$/);
  });

  it('the .d.mts declarations still describe the modules they document', async () => {
    // Nothing type-checks scripts/**, so this is the only thing catching drift.
    const resolver = await import('../../scripts/resolve-api-url.mjs');
    const wrapper = await import('../../scripts/generate-types.mjs');
    expect(Object.keys(resolver).sort()).toEqual(
      ['OPENAPI_PATH', 'findLtDevEnvFile', 'findOwnRegistration', 'parseEnvFile', 'readLtDevRegistrations', 'resolveApiInput', 'withOpenApiPath'].sort(),
    );
    expect(Object.keys(wrapper).sort()).toEqual(['redactUrl', 'runGenerateTypes'].sort());
  });
});
