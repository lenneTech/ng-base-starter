/**
 * Public surface of `scripts/check-suppressions.mjs`, so the unit tests can import its helpers
 * under `strict`. Everything not declared here is internal.
 */

export type SuppressionStatus = 'fix-available' | 'fix-in-quarantine' | 'fix-unpublished' | 'not-present' | 're-test' | 'unfixable' | 'unusable-fix' | 'unverified' | 'withdrawn';

/** Who depends on a package in the lockfile; `scanned` is false when neither lockfile half was found. */
export interface LockParents {
  /** `consumer@version`, or `the workspace package '<path>'` for an importer. */
  parents: string[];
  scanned: boolean;
}

/** An `auditConfig.unusableFixConsumers` value, split. */
export interface ResidualDeclaration {
  consumers: { assessedAt: string; consumer: string }[];
  /** Fix versions the consumers were assessed against and cannot use. */
  rejected: string[];
}

/** The parts of a full npm packument (`GET registry.npmjs.org/{name}`) the check reads. */
export interface Packument {
  /** ISO publish date per version. */
  time: Record<string, string>;
  versions: Record<string, { deprecated?: string }>;
}

export interface SuppressionResult {
  /** Why the entry got its verdict, for the report line. */
  detail: string;
  /** GHSA id as listed under `ignoreGhsas`. */
  id: string;
  status: SuppressionStatus;
}

export interface SuppressionDeps {
  fetchAdvisory: (id: string) => Promise<{ advisory: unknown; ok: true } | { ok: false; reason: string }>;
  /**
   * Who depends on a package: every edge into a version inside one of `ranges` (or one it cannot
   * read); null when the lockfile cannot be read. Read only for a declared entry.
   */
  lockedParents?: (name: string, ranges: string[]) => LockParents | null;
  /** Versions the lockfile resolves for a package; null when the lockfile cannot be read. */
  lockedVersions: (name: string) => string[] | null;
  /** The release-age gate a fix must clear; defaults to pnpm 11's 1440 minutes. */
  minimumReleaseAgeMinutes?: number;
  /** Current time in ms; defaults to `Date.now()`. */
  now?: number;
  /** The package's packument; empty when it does not exist, null when the registry could not be asked. */
  npmPackument: (name: string) => Promise<Packument | null>;
  /** `auditConfig.unusableFixConsumers`: GHSA id → `'<consumer>@<version> + … cannot use <fix>'`. */
  unusableFixConsumers?: Record<string, string>;
}

/** Verdicts that make the check fail. */
export const OBSOLETE: ReadonlySet<SuppressionStatus>;
export const DEFAULT_MINIMUM_RELEASE_AGE_MINUTES: number;
export function assessSuppression(id: string, deps: SuppressionDeps): Promise<SuppressionResult>;
export function createAdvisoryFetcher(options?: { fetchImpl?: typeof fetch; token?: string }): SuppressionDeps['fetchAdvisory'];
export function createNpmPackumentFetcher(options?: { fetchImpl?: typeof fetch }): SuppressionDeps['npmPackument'];
/** Without `ranges` every edge counts; with them, only edges into an affected (or unreadable) version. */
export function dependentsOf(lockText: string, name: string, ranges?: string[]): LockParents;
/** The `minimumReleaseAge` a pnpm-workspace.yaml sets at the top level, else 1440. */
export function minimumReleaseAgeOf(workspaceText: string | null | undefined): number;
export function exitCodeFor(results: SuppressionResult[], context: { ci: boolean; token: boolean }): 0 | 1;
/** Nearest directory at or above `start` holding a pnpm-workspace.yaml; null when none. */
export function findWorkspaceRoot(start: string, exists?: (path: string) => boolean): string | null;
export function inVulnerableRange(version: string, range: string | null | undefined): boolean | null;
export function listSuppressions(workspaceYaml: string): string[];
export function listUnusableFixConsumers(workspaceYaml: string): Record<string, string>;
export function parseResidual(raw: string): ResidualDeclaration;
export function patchedVersionOf(vulnerability: unknown): string | null;
export function resolvedVersions(lockText: string, name: string): string[];
/** Resolves to the exit code. */
export function run(options?: { cwd?: string; env?: Record<string, string | undefined>; log?: (line: string) => void }): Promise<0 | 1>;
export function summaryLine(results: SuppressionResult[]): string;
