/**
 * Public surface of `scripts/resolve-api-url.mjs` — the API-URL resolution
 * `generate-types` runs through (DEV-2802).
 *
 * The module itself is plain JavaScript on purpose: it is loaded by bare
 * `node scripts/generate-types.mjs` and by `openapi-ts.config.ts`, both outside
 * any build step. This file exists so specs can import it under `strict`
 * without `allowJs` — the same reason `scripts/check.d.mts` exists upstream —
 * and it doubles as the written-down contract of what the resolver exposes.
 *
 * No type-check gate covers it today: `nuxt typecheck`'s program is `app/**` +
 * `server/**`, so `scripts/**`, `openapi-ts.config.ts` and `tests/**` are all
 * outside it (the last is DEV-2900). Drift between this file and the `.mjs` is
 * therefore caught by the export-surface assertion in
 * `tests/unit/generate-types-api-url.spec.ts`, not by the compiler.
 */

/** Path the API serves its OpenAPI document under. */
export declare const OPENAPI_PATH: string;

/** A project as `lt dev` records it in `~/.lenneTech/projects.json`. */
export interface LtDevRegistration {
  /** Hostname `lt dev` serves the API under, or `null` when the project has no API. */
  apiHost: null | string;
  /** Absolute repo root the slug is registered for. */
  path: string;
  /** Project slug (e.g. `lt-crm-2`). */
  slug: string;
}

/** Everything the resolver needs, injected so the rules stay unit-testable. */
export interface ResolveApiInputDeps {
  /** Directory the command runs in (usually `projects/app`). */
  cwd: string;
  /** Environment to read `NG_API_URL` from. */
  env: Record<string, string | undefined>;
  /** Home directory holding the `lt dev` registry. */
  homeDir: string;
  /** File reader returning `undefined` for a missing file. */
  readTextFile: (filePath: string) => string | undefined;
}

/** Outcome of a successful resolution. */
export interface ResolvedApiInput {
  /** Full URL of the OpenAPI document (base + {@link OPENAPI_PATH}). */
  input: string;
  /** Variables read from `.lt-dev/.env` (empty when absent). */
  ltDevEnv: Record<string, string>;
  /** Own `lt dev` slug, or `null` when the project is not registered. */
  slug: null | string;
  /** Where the URL came from. */
  source: 'env' | 'lt-dev';
  /** API base URL, without the OpenAPI path. */
  url: string;
  /** Non-fatal remarks to print before generating. */
  warnings: string[];
}

/** Parse `KEY=VALUE` lines of an env file (uppercase keys only). */
export declare function parseEnvFile(content: string): Record<string, string>;

/** Walk upward from `cwd` looking for `<dir>/.lt-dev/.env`, never above `stopAt`. */
export declare function findLtDevEnvFile(
  cwd: string,
  readTextFile: (filePath: string) => string | undefined,
  stopAt?: null | string,
): null | { path: string; vars: Record<string, string> };

/** Read every project `lt dev` knows about; `[]` when the registry is absent or malformed. */
export declare function readLtDevRegistrations(homeDir: string, readTextFile: (filePath: string) => string | undefined): LtDevRegistration[];

/** Find the registration the given directory belongs to (separator-boundary match, longest wins). */
export declare function findOwnRegistration(registrations: LtDevRegistration[], cwd: string): LtDevRegistration | null;

/** Append {@link OPENAPI_PATH} unless the URL already carries it. */
export declare function withOpenApiPath(url: string): string;

/**
 * Resolve and validate the API URL the client is generated from.
 *
 * @throws When no URL can be resolved, it is malformed, or it belongs to a
 *   different `lt dev` project.
 */
export declare function resolveApiInput(deps: ResolveApiInputDeps): ResolvedApiInput;
