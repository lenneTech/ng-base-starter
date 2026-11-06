/**
 * Resolve the API base URL `generate-types` generates the client from.
 *
 * Template source: ng-base-starter/scripts/resolve-api-url.mjs
 * — keep both copies in sync; fixes belong upstream first.
 *
 * Why this exists (DEV-2802): `openapi-ts.config.ts` used to read
 * `process.env.NG_API_URL || 'http://127.0.0.1:3000'`. On a machine running
 * several lt projects in parallel, port 3000 belongs to *whichever* project
 * happens to hold it — so a shell without the `lt dev up` variables generated
 * `types.gen.ts` / `sdk.gen.ts` from a FOREIGN OpenAPI contract, reported
 * success and exited 0. The damage only surfaced much later, far away from the
 * cause.
 *
 * The contract implemented here:
 *
 *   1. An explicit `NG_API_URL` wins — CI, Docker and `lt dev up` all set it.
 *   2. Otherwise `<repo-root>/.lt-dev/.env` supplies it, so the documented
 *      `pnpm run generate-types` works under `lt dev up` without extra env.
 *   3. Otherwise the run FAILS with an actionable message. There is deliberately
 *      no default: guessing a port is exactly the bug.
 *   4. A URL that provably belongs to a DIFFERENT `lt dev` project fails too —
 *      that is the "wrong API answers wrong frontend" class `lt dev` otherwise
 *      protects against.
 *
 * The bridge file is read on BOTH paths, not only as a URL fallback: it also
 * carries `NODE_EXTRA_CA_CERTS` for the Caddy local CA, and the need for that
 * trust anchor does not depend on where the URL came from. Coupling the two
 * broke the tool's own documented escape hatch (`NG_API_URL=… pnpm run
 * generate-types` died with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`).
 *
 * A guard that silently stops guarding recreates the very bug it was added for,
 * so every branch that cannot check something says so via `warnings` instead of
 * returning quietly.
 *
 * Everything is dependency-injected (`env`, `cwd`, `homeDir`, `readTextFile`)
 * so the rules are unit-testable without touching the real machine.
 */

/** Path the API serves its OpenAPI document under. */
export const OPENAPI_PATH = '/api-docs-json';

/** Registry `lt dev` maintains for every project on this machine. */
const LT_DEV_REGISTRY = '.lenneTech/projects.json';

/**
 * Directory levels probed while looking for `.lt-dev/.env`.
 *
 * Only load-bearing when the project is NOT registered with `lt dev` — a
 * registered project bounds the walk at its own repo root instead, so no
 * ancestor outside the project can supply the URL or the child environment.
 */
const LT_DEV_ENV_SEARCH_DEPTH = 6;

/**
 * @typedef {object} LtDevRegistration
 * @property {string} slug Project slug (`lt-crm-2`).
 * @property {string} path Absolute repo root the slug is registered for.
 * @property {null | string} apiHost Hostname `lt dev` serves the API under, if any.
 */

/**
 * @typedef {object} ResolveApiInputDeps
 * @property {string} cwd Directory the command runs in (usually `projects/app`).
 * @property {Record<string, string | undefined>} env Environment to read `NG_API_URL` from.
 * @property {string} homeDir Home directory holding the `lt dev` registry.
 * @property {(filePath: string) => string | undefined} readTextFile Reader returning `undefined` for a missing file.
 */

/**
 * @typedef {object} ResolvedApiInput
 * @property {string} input Full URL of the OpenAPI document (base + {@link OPENAPI_PATH}).
 * @property {Record<string, string>} ltDevEnv Variables read from `.lt-dev/.env` (empty when absent).
 * @property {null | string} slug Own `lt dev` slug, or `null` when unregistered.
 * @property {'env' | 'lt-dev'} source Where the URL came from.
 * @property {string} url API base URL, without the OpenAPI path.
 * @property {string[]} warnings Non-fatal remarks the caller MUST print.
 */

/**
 * Normalise a filesystem path to forward slashes, without a trailing one.
 *
 * The walk and the boundary match below are string operations, which is only
 * safe once separators agree — a Windows `C:\repo\projects\app` would otherwise
 * never split, so the upward search would stop at level 0 and the project
 * attribution would never match.
 *
 * @param {string} filePath Path in either separator style.
 * @returns {string} Path with `/` separators and no trailing slash.
 */
function toPosix(filePath) {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Canonical form of a hostname for comparison.
 *
 * `new URL().hostname` already lower-cases and punycodes, but it preserves a
 * fully-qualified trailing dot — and `api.<slug>.localhost.` is answered by
 * Caddy exactly like the dotless form. Comparing raw therefore let a foreign
 * host slip past the refusal into the warn branch. The registry side is
 * hand-written and needs the lower-casing too.
 *
 * @param {string} hostname Hostname to canonicalise.
 * @returns {string} Comparable hostname.
 */
function canonHost(hostname) {
  return hostname.replace(/\.$/, '').toLowerCase();
}

/**
 * Parse `KEY=VALUE` lines of an env file.
 *
 * Deliberately the same narrow grammar as the `lt-dev:bridge` block in
 * `playwright.config.ts`: uppercase keys only, no quote stripping, no
 * interpolation — the file is machine-written by `lt dev up`. Values may
 * contain `=` and spaces (`NODE_EXTRA_CA_CERTS` holds both).
 *
 * @param {string} content Raw file content.
 * @returns {Record<string, string>} Parsed variables.
 */
export function parseEnvFile(content) {
  /** @type {Record<string, string>} */
  const vars = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) {
      vars[match[1]] = match[2];
    }
  }
  return vars;
}

/**
 * Walk upward from `cwd` looking for `<dir>/.lt-dev/.env`.
 *
 * `.lt-dev/` sits at the repo root while the command runs in `projects/app`,
 * hence the upward search rather than a fixed relative path.
 *
 * `stopAt` bounds the walk at the project's own repo root. Without it the walk
 * reaches `~/code` and `~`, where a stale or foreign bridge file would supply
 * both the API URL and the whole child environment for a project whose own root
 * has none.
 *
 * @param {string} cwd Directory to start from.
 * @param {(filePath: string) => string | undefined} readTextFile File reader.
 * @param {null | string} [stopAt] Highest directory to probe (inclusive).
 * @returns {null | { path: string; vars: Record<string, string> }} Hit, or `null`.
 */
export function findLtDevEnvFile(cwd, readTextFile, stopAt = null) {
  const boundary = stopAt ? toPosix(stopAt) : null;
  let dir = toPosix(cwd);

  for (let level = 0; level < LT_DEV_ENV_SEARCH_DEPTH; level++) {
    const candidate = `${dir}/.lt-dev/.env`;
    const content = readTextFile(candidate);
    if (content !== undefined) {
      return { path: candidate, vars: parseEnvFile(content) };
    }
    if (boundary !== null && dir === boundary) {
      break;
    }
    const parent = dir.replace(/\/[^/]*$/, '');
    if (parent === dir || parent === '') {
      break;
    }
    dir = parent;
  }
  return null;
}

/**
 * Read every project `lt dev` knows about.
 *
 * A missing or malformed registry is not an error — it simply means this
 * machine does not use `lt dev`, so no cross-project checks apply.
 *
 * @param {string} homeDir Home directory holding the registry.
 * @param {(filePath: string) => string | undefined} readTextFile File reader.
 * @returns {LtDevRegistration[]} Registered projects (possibly empty).
 */
export function readLtDevRegistrations(homeDir, readTextFile) {
  const content = readTextFile(`${toPosix(homeDir)}/${LT_DEV_REGISTRY}`);
  if (!content) {
    return [];
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const projects = /** @type {Record<string, { path?: string; subdomains?: { api?: string } }>} */ (/** @type {any} */ (parsed)?.projects);
  if (!projects || typeof projects !== 'object') {
    return [];
  }

  return Object.entries(projects)
    .filter(([, entry]) => typeof entry?.path === 'string' && entry.path.length > 0)
    .map(([slug, entry]) => ({
      apiHost: typeof entry.subdomains?.api === 'string' ? entry.subdomains.api : null,
      path: /** @type {string} */ (entry.path),
      slug,
    }));
}

/**
 * Find the registration the given directory belongs to.
 *
 * Matches on a path-SEPARATOR boundary, never on a bare string prefix:
 * `/code/lt-crm` is a string prefix of `/code/lt-crm-2`, so a naive
 * `startsWith` would attribute lt-crm-2's checkout to lt-crm — the exact
 * cross-project confusion this module exists to prevent. The longest match
 * wins so a nested registration beats its parent.
 *
 * The comparison is case-sensitive. On a case-insensitive volume (macOS APFS
 * by default) a differently-cased cwd therefore finds nothing — which is why
 * {@link resolveApiInput} warns rather than silently skipping the guard when a
 * populated registry yields no owner.
 *
 * @param {LtDevRegistration[]} registrations Known projects.
 * @param {string} cwd Directory to attribute.
 * @returns {LtDevRegistration | null} Owning registration, or `null`.
 */
export function findOwnRegistration(registrations, cwd) {
  const normalized = toPosix(cwd);
  /** @type {LtDevRegistration | null} */
  let best = null;
  let bestLength = -1;

  for (const registration of registrations) {
    const root = toPosix(registration.path);
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      if (root.length > bestLength) {
        best = registration;
        bestLength = root.length;
      }
    }
  }
  return best;
}

/**
 * Append {@link OPENAPI_PATH} unless the URL already carries it.
 *
 * `lt dev up` exports `NG_API_URL` as the API BASE url
 * (`https://api.<slug>.localhost`). Handing that to the generator verbatim made
 * it fetch the API root and fail with `"…" is not a valid JSON Schema`.
 *
 * The check is on the PATH, not on the whole string: a plain `includes` also
 * matched a host merely containing the token, and appending to a URL carrying a
 * query string produced `…/?v=1/api-docs-json`.
 *
 * @param {string} url API base URL or full OpenAPI document URL.
 * @returns {string} URL of the OpenAPI document.
 */
export function withOpenApiPath(url) {
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // Not parseable — leave it to the caller's own validation and only avoid
    // doubling an obviously present path.
    return url.endsWith(OPENAPI_PATH) ? url : `${url.replace(/\/+$/, '')}${OPENAPI_PATH}`;
  }

  if (parsed.pathname.replace(/\/+$/, '').endsWith(OPENAPI_PATH)) {
    return url;
  }

  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}${OPENAPI_PATH}`;
  return parsed.href;
}

/**
 * Hostnames that legitimately serve THIS project's API under `lt dev`.
 *
 * `lt dev up` serves `api.<slug>.localhost`; `lt dev test` runs an isolated
 * parallel stack under `api.<slug>-test.localhost`. Both are this project.
 *
 * This expansion is a GUESS about a host nobody registered, so an actual
 * registration always outranks it — see {@link assertNotForeign}.
 *
 * @param {string} apiHost Registered API hostname.
 * @returns {string[]} Accepted hostnames, canonicalised.
 */
function ownHostVariants(apiHost) {
  const host = canonHost(apiHost);
  const test = host.replace(/^(api\.)(.+)(\.localhost)$/, '$1$2-test$3');
  return test === host ? [host] : [host, test];
}

/**
 * Resolve and validate the API URL the client is generated from.
 *
 * @param {ResolveApiInputDeps} deps Injected environment.
 * @returns {ResolvedApiInput} Resolved URL plus everything the caller must pass on.
 * @throws {Error} When no URL can be resolved, when it is not a valid URL, or
 *   when it belongs to a different `lt dev` project.
 */
export function resolveApiInput(deps) {
  const { cwd, env, homeDir, readTextFile } = deps;

  const registrations = readLtDevRegistrations(homeDir, readTextFile);
  const own = findOwnRegistration(registrations, cwd);

  // Always read the bridge — it carries NODE_EXTRA_CA_CERTS, which is needed
  // regardless of where the URL came from (see the module header).
  const bridge = findLtDevEnvFile(cwd, readTextFile, own?.path ?? null);

  const fromEnv = (env.NG_API_URL || '').trim();
  const fromBridge = (bridge?.vars.NG_API_URL || '').trim();

  const url = fromEnv || fromBridge;
  if (!url) {
    throw new Error(buildMissingUrlMessage(own, bridge?.path ?? null));
  }

  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`NG_API_URL is not a valid URL: "${url}". Expected something like https://api.<slug>.localhost.`);
  }

  const source = /** @type {'env' | 'lt-dev'} */ (fromEnv ? 'env' : 'lt-dev');
  const warnings = assertNotForeign(parsed.hostname, own, registrations, source, bridge?.path ?? null);

  return {
    input: withOpenApiPath(url),
    ltDevEnv: bridge?.vars ?? {},
    slug: own?.slug ?? null,
    source,
    url,
    warnings,
  };
}

/**
 * Build the message for "no URL could be resolved".
 *
 * Deliberately names no port: printing a plausible-looking default is what
 * made developers reach for it in the first place. It also distinguishes "no
 * bridge file" from "bridge file without the key" — the merged wording sent
 * developers looking for a file that was sitting right there.
 *
 * @param {LtDevRegistration | null} own Own registration, if any.
 * @param {null | string} bridgePath Path of the bridge file that was read, if any.
 * @returns {string} Actionable error message.
 */
function buildMissingUrlMessage(own, bridgePath) {
  const cause = bridgePath ? `NG_API_URL is not set, and ${bridgePath} does not define it either.` : 'NG_API_URL is not set and no .lt-dev/.env was found.';

  const closing = ['There is deliberately no default — guessing a port generates the client', 'from whichever project happens to hold it (DEV-2802).'];

  if (own) {
    return [
      cause,
      '',
      `This project is registered with \`lt dev\` as "${own.slug}"${own.apiHost ? ` (API: https://${own.apiHost})` : ''}.`,
      'Start the stack and try again:',
      '',
      `    lt dev up            # in ${own.path}`,
      '    pnpm run generate-types',
      '',
      'Or point the generator at an API explicitly. It is read from the SHELL',
      'environment — a .env file is NOT read by the generator:',
      '',
      '    NG_API_URL=<api-base-url> pnpm run generate-types',
      '',
      ...closing,
    ].join('\n');
  }

  return [
    cause,
    '',
    'Point the generator at the API of THIS project. It is read from the SHELL',
    'environment — a .env file is NOT read by the generator:',
    '',
    '    NG_API_URL=<api-base-url> pnpm run generate-types',
    '',
    'Or start the project through `lt dev up`, which exports it for you.',
    '',
    ...closing,
  ].join('\n');
}

/**
 * Reject a hostname that provably belongs to another `lt dev` project.
 *
 * Order matters: a REAL registration is consulted before the synthesized
 * `-test` twin. The other way round, a project actually registered as
 * `<own-slug>-test` was accepted as this project — silently, with no warning at
 * all, which is the original DEV-2802 signature.
 *
 * An unrelated host (staging, a container name, a plain localhost port) is
 * allowed: setting `NG_API_URL` by hand is a deliberate act. It earns a
 * warning, never silence.
 *
 * Comparison is on the hostname, so the PORT is not part of the identity:
 * `lt dev` separates projects by subdomain, not by port. That is a real limit,
 * pinned by test.
 *
 * @param {string} hostname Hostname of the resolved URL.
 * @param {LtDevRegistration | null} own Own registration, if any.
 * @param {LtDevRegistration[]} registrations All known projects.
 * @param {'env' | 'lt-dev'} source Where the URL came from (shapes the wording).
 * @param {null | string} bridgePath Bridge file the URL/environment came from, if any.
 * @returns {string[]} Warnings (empty only when the host matches this project).
 * @throws {Error} When the hostname belongs to a different registered project.
 */
function assertNotForeign(hostname, own, registrations, source, bridgePath) {
  const host = canonHost(hostname);

  /** @param {null | string} ownSlug @returns {LtDevRegistration | undefined} */
  const findForeign = (ownSlug) =>
    registrations.find((registration) => registration.slug !== ownSlug && registration.apiHost && ownHostVariants(registration.apiHost).includes(host));

  if (own) {
    // A real registration always outranks the synthesized twin below.
    const foreign = findForeign(own.slug);
    if (foreign) {
      throwForeign(host, own, foreign);
    }

    if (!own.apiHost) {
      return [`The \`lt dev\` registration for "${own.slug}" has no API host, so the cross-project check is INACTIVE. Verify that "${hostname}" really serves this project's API.`];
    }

    if (ownHostVariants(own.apiHost).includes(host)) {
      return [];
    }

    const origin = source === 'env' ? 'NG_API_URL was set explicitly' : 'it came from the .lt-dev/.env bridge';
    return [
      `Generating from "${hostname}", which is not this project's \`lt dev\` API (https://${own.apiHost}). Continuing because ${origin} — make sure that host really serves the "${own.slug}" API.`,
    ];
  }

  // No registration claims this checkout. A bridge file written INTO this repo
  // root by `lt dev up` still identifies it, so that URL is trusted — but the
  // mismatch is reported, because it usually means a moved/renamed checkout or
  // a case-differing registry path, and the guard is off until that is fixed.
  if (source === 'lt-dev' && bridgePath) {
    return [`No \`lt dev\` project claims this checkout, so the cross-project check is INACTIVE. Using the URL from ${bridgePath}.`];
  }

  const foreign = findForeign(null);
  if (foreign) {
    throwForeign(host, own, foreign);
  }

  return registrations.length > 0
    ? [
        `No \`lt dev\` project claims this checkout, so the cross-project check is INACTIVE (the registry knows ${registrations.length} project(s)). Verify that "${hostname}" really serves this project's API.`,
      ]
    : [];
}

/**
 * Throw the "foreign project" refusal.
 *
 * Split out so {@link assertNotForeign} reads as one decision table.
 *
 * @param {string} host Canonical hostname that was rejected.
 * @param {LtDevRegistration | null} own Own registration, if any.
 * @param {LtDevRegistration} foreign The project that owns the host.
 * @returns {never} Always throws.
 */
function throwForeign(host, own, foreign) {
  const subject = own ? `the API client of "${own.slug}"` : 'this API client';
  throw new Error(
    [
      `Refusing to generate ${subject} from "${host}".`,
      `That host belongs to the "${foreign.slug}" project (${foreign.path}).`,
      '',
      'Generating from a foreign contract silently writes types.gen.ts / sdk.gen.ts',
      'for the wrong API — the failure only surfaces much later (DEV-2802).',
      '',
      ...(own?.apiHost ? [`Expected: https://${own.apiHost}  (or its \`lt dev test\` twin)`] : []),
      'Fix: unset NG_API_URL, or run `lt dev up` in this project.',
    ].join('\n'),
  );
}
