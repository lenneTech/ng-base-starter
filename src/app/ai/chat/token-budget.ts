import type { LtAiBudgetSummary } from '@lenne.tech/ng-base/ai';

import { type AiUsageTone, formatDateTime, formatTokens } from '../ai-format';

/**
 * Figures of the token bar and the usage badge, from the compact budget every chat response carries.
 *
 * The backend resolves the limit (the bar only renders it): user limit, tenant limit (both admin-configured, hard 429 on
 * overflow), then the provider quota (`connection.defaultUserMaxTokens`) and the LLM context window as soft defaults
 * (`scope: 'llm'`). `usedTokens` is always the running total of the period, `promptTokens` the cost of the last request.
 */
export interface AiTokenBudgetFigures {
  /** Tokens of the last request. */
  lastRequest: number;
  /** Effective limit; 0 when there is none (then the bar is hidden). */
  max: number;
  /** Tokens left: the backend's figure, else limit minus usage (never negative). */
  remaining: number;
  /** Tokens used in the current period. */
  used: number;
  /** Used share of the limit in percent (0–100). */
  usedPercent: number;
}

/** Up to here the bar stays green. */
export const TOKEN_BAR_WARNING_FROM = 50;
/** From here the bar turns red. */
export const TOKEN_BAR_CRITICAL_FROM = 85;

export function tokenBudgetFigures(budget: LtAiBudgetSummary | null | undefined): AiTokenBudgetFigures {
  const max = typeof budget?.maxTokens === 'number' ? budget.maxTokens : 0;
  const used = typeof budget?.usedTokens === 'number' ? budget.usedTokens : 0;
  const lastRequest = typeof budget?.promptTokens === 'number' ? budget.promptTokens : 0;
  const remaining = typeof budget?.remainingTokens === 'number' ? budget.remainingTokens : Math.max(0, max - used);
  const usedPercent = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return { lastRequest, max, remaining, used, usedPercent };
}

/** Colour level of the bar: normal (green) below 50 %, warning from 50 %, critical from 85 %. */
export function tokenBarTone(usedPercent: number): AiUsageTone {
  if (usedPercent >= TOKEN_BAR_CRITICAL_FROM) {
    return 'critical';
  }
  if (usedPercent >= TOKEN_BAR_WARNING_FROM) {
    return 'warning';
  }
  return 'normal';
}

/** Heading of the popover: where the limit comes from. */
export function budgetScopeLabel(scope: LtAiBudgetSummary['scope']): string {
  switch (scope) {
    case 'llm':
      return 'Anbieter-Quota (weich)';
    case 'tenant':
      return 'Tenant-Limit';
    case 'user':
      return 'Nutzer-Limit';
    default:
      return 'Limit';
  }
}

/** What the limit means; empty for an unknown scope. */
export function budgetScopeDescription(scope: LtAiBudgetSummary['scope']): string {
  switch (scope) {
    case 'llm':
      return 'Vom Anbieter / Kontextfenster abgeleitete weiche Obergrenze — kein hartes 429.';
    case 'tenant':
      return 'Vom Admin konfiguriertes Token-Limit pro Tenant. Bei Überschreitung antwortet das Backend mit 429.';
    case 'user':
      return 'Vom Admin konfiguriertes Token-Limit pro Nutzer. Bei Überschreitung antwortet das Backend mit 429.';
    default:
      return '';
  }
}

/** Text of the usage badge (cost of the last request); empty while no request reported one, then the badge is hidden. */
export function usageBadgeLabel(budget: LtAiBudgetSummary | null | undefined): string {
  const tokens = budget?.promptTokens;
  return typeof tokens === 'number' ? `${formatTokens(tokens)} Tokens (letzte Anfrage)` : '';
}

/** Tooltip of the usage badge: the end of the period when one is active. */
export function usageBadgeTooltip(budget: LtAiBudgetSummary | null | undefined): string {
  const resetAt = formatDateTime(budget?.resetAt);
  return resetAt ? `Periode endet: ${resetAt}` : 'Tokens der letzten Anfrage';
}
