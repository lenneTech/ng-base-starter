#!/usr/bin/env node
/**
 * Guarded entry point for `pnpm run generate-types` (DEV-2802).
 *
 * Template source: ng-base-starter/scripts/generate-types.mjs
 * — keep both copies in sync; fixes belong upstream first.
 *
 * Resolves the API URL through `resolve-api-url.mjs`, prints where it came
 * from, and only then runs `openapi-ts` — as a CHILD process.
 *
 * The child process is not cosmetic. Under `lt dev up` the API is served over
 * HTTPS by Caddy's local CA, which Node only trusts via `NODE_EXTRA_CA_CERTS`
 * — and Node reads that variable at STARTUP. Setting `process.env` from inside
 * `openapi-ts.config.ts` would be too late (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`),
 * so the values loaded from `.lt-dev/.env` have to be handed to a fresh process.
 *
 * The whole run is exposed as {@link runGenerateTypes} with its side effects
 * injected, because the one contract that must not regress — a failing
 * generation must not exit 0 — is exactly the DEV-2802 symptom one layer up,
 * and a source-text assertion cannot pin it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { constants as osConstants, homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveApiInput } from './resolve-api-url.mjs';

/** Directory of the app this script belongs to (never the caller's cwd). */
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Environment variables forwarded from `.lt-dev/.env` into the child.
 *
 * An allowlist rather than the whole file: the bridge also carries
 * `DATABASE_URL` / `NSC__MONGOOSE__URI`, and `openapi-ts` spawns `oxlint` and
 * `oxfmt` as post-processors that would inherit them. It would equally forward
 * `NODE_OPTIONS` or `NODE_TLS_REJECT_UNAUTHORIZED`, the latter disabling the
 * very TLS verification `NODE_EXTRA_CA_CERTS` is here to enable.
 */
const FORWARDED_ENV = /^(NODE_EXTRA_CA_CERTS|NG_API_URL|NG_PUBLIC_API_URL|LT_DEV_ACTIVE)$/;

/**
 * `openapi-ts` flags that would override the validated input.
 *
 * Forwarding them silently makes the log line contradict the run: the wrapper
 * reports the URL it validated while the generator fetches another one.
 */
const INPUT_OVERRIDE_FLAGS = ['-f', '--file', '-i', '--input'];

/**
 * Read a file, returning `undefined` when it does not exist.
 *
 * @param {string} filePath Absolute path.
 * @returns {string | undefined} Content, or `undefined`.
 */
function readTextFileSync(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Strip credentials from a URL before printing it.
 *
 * A URL like `https://user:token@api.example.com` is a plausible way to reach a
 * protected staging API, and the resolved URL is echoed on every run — into
 * terminal scrollback, screenshots and pasted error reports.
 *
 * @param {string} url URL to display.
 * @returns {string} URL without userinfo.
 */
export function redactUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) {
      return url;
    }
    parsed.password = '';
    parsed.username = '';
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Run the generator.
 *
 * @param {object} deps Injected side effects.
 * @param {string} [deps.appDir] Directory of the app (defaults to this script's app).
 * @param {string[]} deps.argv Arguments forwarded to `openapi-ts`.
 * @param {Record<string, string | undefined>} deps.env Parent environment.
 * @param {string} deps.homeDir Home directory holding the `lt dev` registry.
 * @param {{ error: (m: string) => void; log: (m: string) => void; warn: (m: string) => void }} deps.log Output sink.
 * @param {(filePath: string) => string | undefined} deps.readTextFile File reader.
 * @param {(command: string, args: string[], options: { cwd: string; env: Record<string, string | undefined>; stdio: 'inherit' }) => { error?: Error; signal?: null | string; status: null | number }} deps.spawn Child-process runner.
 * @returns {number} Process exit code — non-zero whenever generation did not succeed.
 */
export function runGenerateTypes(deps) {
  const { appDir = APP_DIR, argv, env, homeDir, log, readTextFile, spawn } = deps;

  const override = argv.find((arg) => INPUT_OVERRIDE_FLAGS.includes(arg) || INPUT_OVERRIDE_FLAGS.some((flag) => arg.startsWith(`${flag}=`)));
  if (override) {
    log.error(
      `\ngenerate-types: refusing to forward "${override}" — it overrides the API URL this wrapper validated, so the reported and the generated contract would differ.\nSet NG_API_URL instead; it is validated (DEV-2802).\n`,
    );
    return 1;
  }

  /** @type {import('./resolve-api-url.mjs').ResolvedApiInput} */
  let resolved;
  try {
    // Resolve from appDir, never from process.cwd(): the script's own location
    // identifies the project it belongs to, whereas the cwd identifies wherever
    // the caller happened to stand. Invoked from a sibling checkout
    // (`cd ../other && node ../this/scripts/generate-types.mjs`) a cwd-based
    // lookup would read the OTHER project's .lt-dev/.env and registration — the
    // very cross-project mix-up this wrapper exists to prevent.
    resolved = resolveApiInput({ cwd: appDir, env, homeDir, readTextFile });
  } catch (error) {
    log.error(`\ngenerate-types: ${/** @type {Error} */ (error).message}\n`);
    return 1;
  }

  for (const warning of resolved.warnings) {
    log.warn(`generate-types: WARNING — ${warning}`);
  }

  const origin = resolved.source === 'env' ? 'NG_API_URL' : '.lt-dev/.env';
  log.log(`generate-types: reading ${redactUrl(resolved.input)} (source: ${origin}${resolved.slug ? `, project: ${resolved.slug}` : ', project: unregistered'})`);

  // Bridge semantics, identical to playwright.config.ts: the shell always wins,
  // the file only fills what is missing.
  /** @type {Record<string, string | undefined>} */
  const childEnv = { ...env };
  for (const [key, value] of Object.entries(resolved.ltDevEnv)) {
    if (FORWARDED_ENV.test(key) && childEnv[key] === undefined) {
      childEnv[key] = value;
    }
  }
  childEnv.NG_API_URL = resolved.url;

  // Spawn the generator's JS entry with the current Node binary instead of the
  // `.bin` shim. The shim is a `.cmd` on Windows, and since the CVE-2024-27980
  // mitigation Node refuses to spawn `.cmd`/`.bat` without `shell: true` —
  // which would in turn expose the forwarded arguments to shell parsing. This
  // form is shell-free and identical on every platform, and it removes the
  // silent PATH fallback that could have run a foreign global install.
  const entry = join(appDir, 'node_modules', '@hey-api', 'openapi-ts', 'bin', 'run.js');
  if (!existsSync(entry)) {
    log.error(`\ngenerate-types: @hey-api/openapi-ts is not installed at ${entry}.\nRun \`pnpm install\` in ${appDir} and try again.\n`);
    return 1;
  }

  const result = spawn(process.execPath, [entry, ...argv], { cwd: appDir, env: childEnv, stdio: 'inherit' });

  if (result.error) {
    log.error(`\ngenerate-types: could not start the generator — ${result.error.message}\n`);
    return 1;
  }

  // A signal-killed child reports status null. Collapsing that to 1 makes an
  // abort indistinguishable from a failure; 128 + signum is the shell convention.
  if (result.signal) {
    const signum = /** @type {Record<string, number>} */ (osConstants.signals)[result.signal];
    return signum ? 128 + signum : 1;
  }

  return result.status ?? 1;
}

/**
 * Whether this module was started as the CLI entry point.
 *
 * Importing it (from the spec) must not run a generation. No `argv[1]` means
 * node was started without a script path, which is never how this script runs.
 *
 * @returns {boolean} `true` when invoked as `node scripts/generate-types.mjs`.
 */
function isCliEntry() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(resolvePath(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  process.exit(
    runGenerateTypes({
      argv: process.argv.slice(2),
      env: process.env,
      homeDir: homedir(),
      log: console,
      readTextFile: readTextFileSync,
      spawn: spawnSync,
    }),
  );
}
