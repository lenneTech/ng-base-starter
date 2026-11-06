import { formatDateTime } from '../ai-format';
import { budgetScopeDescription, budgetScopeLabel, tokenBarTone, tokenBudgetFigures, usageBadgeLabel, usageBadgeTooltip } from './token-budget';

describe('tokenBudgetFigures', () => {
  it('takes limit, usage, last request and remaining from the budget', () => {
    expect(tokenBudgetFigures({ maxTokens: 10000, promptTokens: 321, remainingTokens: 7000, usedTokens: 3000 })).toEqual({
      lastRequest: 321,
      max: 10000,
      remaining: 7000,
      used: 3000,
      usedPercent: 30,
    });
  });

  it('derives the remaining tokens when the backend sends none, never below 0', () => {
    expect(tokenBudgetFigures({ maxTokens: 1000, usedTokens: 400 }).remaining).toBe(600);
    expect(tokenBudgetFigures({ maxTokens: 1000, usedTokens: 1400 }).remaining).toBe(0);
  });

  it('prefers the backend figure for the remaining tokens', () => {
    expect(tokenBudgetFigures({ maxTokens: 1000, remainingTokens: 0, usedTokens: 400 }).remaining).toBe(0);
  });

  it('caps the share at 100 %', () => {
    expect(tokenBudgetFigures({ maxTokens: 1000, usedTokens: 2500 }).usedPercent).toBe(100);
  });

  it('has no limit (max 0, share 0) without a budget or a limit, so the bar stays hidden', () => {
    expect(tokenBudgetFigures(null)).toEqual({ lastRequest: 0, max: 0, remaining: 0, used: 0, usedPercent: 0 });
    expect(tokenBudgetFigures(undefined).max).toBe(0);
    expect(tokenBudgetFigures({ usedTokens: 500 })).toMatchObject({ max: 0, used: 500, usedPercent: 0 });
  });
});

describe('tokenBarTone', () => {
  it('is green below 50 %, amber from 50 % and red from 85 %', () => {
    expect(tokenBarTone(0)).toBe('normal');
    expect(tokenBarTone(49.9)).toBe('normal');
    expect(tokenBarTone(50)).toBe('warning');
    expect(tokenBarTone(84.9)).toBe('warning');
    expect(tokenBarTone(85)).toBe('critical');
    expect(tokenBarTone(100)).toBe('critical');
  });
});

describe('budgetScopeLabel / budgetScopeDescription', () => {
  it('names where the limit comes from', () => {
    expect(budgetScopeLabel('llm')).toBe('Anbieter-Quota (weich)');
    expect(budgetScopeLabel('tenant')).toBe('Tenant-Limit');
    expect(budgetScopeLabel('user')).toBe('Nutzer-Limit');
    expect(budgetScopeLabel(undefined)).toBe('Limit');
  });

  it('explains soft and hard limits', () => {
    expect(budgetScopeDescription('llm')).toContain('kein hartes 429');
    expect(budgetScopeDescription('tenant')).toContain('pro Tenant');
    expect(budgetScopeDescription('user')).toContain('pro Nutzer');
    expect(budgetScopeDescription(undefined)).toBe('');
  });
});

describe('usageBadgeLabel', () => {
  it('shows the cost of the last request in German format', () => {
    expect(usageBadgeLabel({ promptTokens: 1234 })).toBe('1.234 Tokens (letzte Anfrage)');
    expect(usageBadgeLabel({ promptTokens: 0 })).toBe('0 Tokens (letzte Anfrage)');
  });

  it('is empty while no request reported tokens', () => {
    expect(usageBadgeLabel(null)).toBe('');
    expect(usageBadgeLabel({ usedTokens: 10 })).toBe('');
  });
});

describe('usageBadgeTooltip', () => {
  it('names the end of the period when one is active', () => {
    const resetAt = '2026-12-01T00:00:00.000Z';
    expect(usageBadgeTooltip({ promptTokens: 1, resetAt })).toBe(`Periode endet: ${formatDateTime(resetAt)}`);
  });

  it('falls back to a plain explanation', () => {
    expect(usageBadgeTooltip({ promptTokens: 1 })).toBe('Tokens der letzten Anfrage');
    expect(usageBadgeTooltip(null)).toBe('Tokens der letzten Anfrage');
  });
});
