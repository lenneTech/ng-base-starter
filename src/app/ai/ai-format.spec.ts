import { formatDateTime, formatTokens, usagePercent } from './ai-format';

describe('formatTokens', () => {
  it('groups digits the German way', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1234)).toBe('1.234');
    expect(formatTokens(1234567)).toBe('1.234.567');
  });
});

describe('formatDateTime', () => {
  it('shows an ISO timestamp as German date and time', () => {
    expect(formatDateTime('2026-11-06T14:30:00.000Z')).toMatch(/^\d{1,2}\.\d{1,2}\.2026, \d{2}:\d{2}:\d{2}$/);
  });

  it('stays empty for a missing or unreadable value instead of printing "Invalid Date"', () => {
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('not a date')).toBe('');
  });
});

describe('usagePercent', () => {
  it('rounds to whole percent', () => {
    expect(usagePercent(1, 3)).toBe(33);
    expect(usagePercent(2, 3)).toBe(67);
    expect(usagePercent(500, 1000)).toBe(50);
  });

  it('caps at 100 when the limit is exceeded', () => {
    expect(usagePercent(1500, 1000)).toBe(100);
  });

  it('is 0 without a positive limit', () => {
    expect(usagePercent(500, undefined)).toBe(0);
    expect(usagePercent(500, 0)).toBe(0);
    expect(usagePercent(500, -10)).toBe(0);
  });
});
