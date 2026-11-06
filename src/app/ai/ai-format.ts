/**
 * Formatting shared by the AI pages, with the output of the Nuxt template (`toLocaleString('de-DE')`).
 */

/** Traffic-light level of a usage share: the token bar and the context-window ring map it to their colours. */
export type AiUsageTone = 'critical' | 'normal' | 'warning';

/** A token count with German digit grouping (`1.234.567`). */
export function formatTokens(value: number): string {
  return value.toLocaleString('de-DE');
}

/** Date and time of an ISO timestamp in German (`6.11.2026, 14:30:00`); empty for a missing or unreadable value. */
export function formatDateTime(value: null | string | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('de-DE');
}

/** Share of `used` in `max` as a whole percentage, capped at 100; 0 without a positive limit (usage bar of the AI settings). */
export function usagePercent(used: number, max?: number): number {
  return max && max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
}
