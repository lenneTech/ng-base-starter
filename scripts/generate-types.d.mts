/**
 * Public surface of `scripts/generate-types.mjs` — the guarded `generate-types`
 * entry point (DEV-2802).
 *
 * The runner itself is plain JavaScript because it is started by bare
 * `node scripts/generate-types.mjs`. This file exists so specs can import
 * {@link runGenerateTypes} under `strict` without `allowJs`, and it records the
 * contract the wrapper must keep: a failing generation NEVER exits 0.
 *
 * Same caveat as `resolve-api-url.d.mts`: no type-check gate covers
 * `scripts/**` today, so this declaration is pinned by test, not by tsc.
 */

/** Options the wrapper passes to the injected spawn function. */
export interface SpawnOptions {
  /** Directory the generator runs in — always the app dir, never the caller's cwd. */
  cwd: string;
  /** Child environment: the parent's, plus the allowlisted bridge variables. */
  env: Record<string, string | undefined>;
  /** The generator streams straight to the terminal. */
  stdio: 'inherit';
}

/** Result shape the injected spawn function must return (a `spawnSync` subset). */
export interface SpawnResult {
  /** Set when the child could not be started at all. */
  error?: Error;
  /** Signal that terminated the child, if any. */
  signal?: null | string;
  /** Exit code, or `null` when the child was signalled. */
  status: null | number;
}

/** Everything {@link runGenerateTypes} touches outside its own logic. */
export interface RunGenerateTypesDeps {
  /** Directory of the app; defaults to the app this script belongs to. */
  appDir?: string;
  /** Arguments forwarded to `openapi-ts`. */
  argv: string[];
  /** Parent environment. */
  env: Record<string, string | undefined>;
  /** Home directory holding the `lt dev` registry. */
  homeDir: string;
  /** Output sink (`console` in production). */
  log: { error: (message: string) => void; log: (message: string) => void; warn: (message: string) => void };
  /** File reader returning `undefined` for a missing file. */
  readTextFile: (filePath: string) => string | undefined;
  /** Child-process runner (`spawnSync` in production). */
  spawn: (command: string, args: string[], options: SpawnOptions) => SpawnResult;
}

/** Strip credentials from a URL before printing it. */
export declare function redactUrl(url: string): string;

/**
 * Run the generator and return the process exit code.
 *
 * Non-zero whenever generation did not succeed — resolution failure, a refused
 * argument, a missing generator, a failing child, or a signalled child
 * (`128 + signum`).
 */
export declare function runGenerateTypes(deps: RunGenerateTypesDeps): number;
