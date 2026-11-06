/** Typed surface of `scripts/check-angular-baseline.mjs` (the pure helpers its unit test imports). */

export type DeviationKind = 'absent' | 'content' | 'extra' | 'value';

export interface Deviation {
  key?: string[];
  kind: DeviationKind;
  path: string;
}

export interface Allowance extends Deviation {
  reason: string;
}

export const NG_NEW_ARGS: readonly string[];
export const ALLOWED: readonly Allowance[];
export function satisfiesCliRange(version: string, range: string): boolean;
export function keyMatches(pattern: string[], key: string[]): boolean;
export function diffJson(reference: Record<string, unknown>, actual: Record<string, unknown>, prefix?: string[]): { key: string[]; kind: 'extra' | 'value' }[];
export function parseJsonc(text: string): Record<string, unknown>;
export function judge(differences: Deviation[], allowed?: readonly Allowance[]): { stale: Allowance[]; unexplained: Deviation[] };
