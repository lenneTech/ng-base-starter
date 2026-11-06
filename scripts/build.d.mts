/** Typed surface of `scripts/build.mjs` (the pure helpers its unit test imports). */

/** The output dir for a build: `NG_OUTPUT_DIR`, default `.output`. */
export function resolveOutputDir(env?: Record<string, string | undefined>): string;

/** Content of `<dir>/server/index.mjs`. */
export const SHIM_SOURCE: string;

/** Writes the shim into `<outputDir>/server/` and returns its path; throws when `server.mjs` is missing. */
export function writeServerShim(outputDir: string): string;
