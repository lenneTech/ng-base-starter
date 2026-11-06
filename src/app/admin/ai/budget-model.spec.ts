import { buildBudgetInput, emptyBudgetForm, limitValue, PERIOD_OPTIONS, periodLabel } from './budget-model';

describe('periodLabel', () => {
  it('names the three periods in German', () => {
    expect(periodLabel('day')).toBe('Tag');
    expect(periodLabel('month')).toBe('Monat');
    expect(periodLabel('none')).toBe('Ohne Reset');
    expect(PERIOD_OPTIONS.map((option) => option.value)).toEqual(['day', 'month', 'none']);
  });

  it('shows an unknown period as it came', () => {
    expect(periodLabel('week')).toBe('week');
    expect(periodLabel(undefined)).toBe('');
  });
});

describe('limitValue', () => {
  it('shows 0 and empty as unlimited', () => {
    expect(limitValue(undefined)).toBe('∞');
    expect(limitValue(0)).toBe('∞');
    expect(limitValue(5000)).toBe('5000');
  });
});

describe('buildBudgetInput', () => {
  it('needs a reference id', () => {
    expect(buildBudgetInput(emptyBudgetForm())).toBeNull();
    expect(buildBudgetInput({ ...emptyBudgetForm(), refId: '  ' })).toBeNull();
  });

  it('starts per user and per day, unlimited', () => {
    expect(emptyBudgetForm()).toEqual({ maxPrompts: null, maxTokens: null, period: 'day', refId: '', scope: 'user' });
    expect(buildBudgetInput({ ...emptyBudgetForm(), refId: ' u1 ' })).toEqual({
      maxPrompts: undefined,
      maxTokens: undefined,
      period: 'day',
      refId: 'u1',
      scope: 'user',
    });
  });

  it('carries the limits, scope and period', () => {
    expect(buildBudgetInput({ maxPrompts: 10, maxTokens: 50000, period: 'month', refId: 't1', scope: 'tenant' })).toEqual({
      maxPrompts: 10,
      maxTokens: 50000,
      period: 'month',
      refId: 't1',
      scope: 'tenant',
    });
    expect(buildBudgetInput({ ...emptyBudgetForm(), maxTokens: Number.NaN, refId: 'u1' })?.maxTokens).toBeUndefined();
  });
});
