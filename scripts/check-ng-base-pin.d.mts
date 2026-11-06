/** Typed surface of `scripts/check-ng-base-pin.mjs` (the pure helpers its unit test imports). */
export const PACKAGE: string;
export function ngBasePinProblems(
  pkg: {
    dependencies?: Record<string, string>;
    dependenciesMeta?: Record<string, { injected?: boolean }>;
    devDependencies?: Record<string, string>;
  },
  options?: { vendored?: boolean },
): string[];
export function isStrict(env?: Record<string, string | undefined>, argv?: string[]): boolean;
