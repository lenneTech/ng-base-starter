import {
  CONTEXT_RING_CIRCUMFERENCE,
  contextWindowAriaLabel,
  contextWindowDashOffset,
  contextWindowPercent,
  contextWindowTone,
  contextWindowTooltipLines,
  isContextWindowVisible,
} from './context-window';

describe('contextWindowPercent', () => {
  it('is the used share in percent', () => {
    expect(contextWindowPercent({ total: 1000, used: 250 })).toBe(25);
    expect(contextWindowPercent({ total: 200, used: 123 })).toBeCloseTo(61.5);
  });

  it('caps at 100 when the window overflows', () => {
    expect(contextWindowPercent({ total: 1000, used: 1500 })).toBe(100);
  });

  it('is 0 without a window or a positive total', () => {
    expect(contextWindowPercent(null)).toBe(0);
    expect(contextWindowPercent(undefined)).toBe(0);
    expect(contextWindowPercent({ total: 0, used: 10 })).toBe(0);
    expect(contextWindowPercent({ total: -5, used: 10 })).toBe(0);
  });
});

describe('isContextWindowVisible', () => {
  it('shows the ring only from 60 % on', () => {
    expect(isContextWindowVisible({ total: 1000, used: 599 })).toBe(false);
    expect(isContextWindowVisible({ total: 1000, used: 600 })).toBe(true);
    expect(isContextWindowVisible({ total: 1000, used: 1000 })).toBe(true);
  });

  it('hides it without a window', () => {
    expect(isContextWindowVisible(null)).toBe(false);
    expect(isContextWindowVisible(undefined)).toBe(false);
    expect(isContextWindowVisible({ total: 0, used: 0 })).toBe(false);
  });
});

describe('contextWindowTone', () => {
  it('turns to warning at 75 % and to critical at 90 %', () => {
    expect(contextWindowTone(60)).toBe('normal');
    expect(contextWindowTone(74.9)).toBe('normal');
    expect(contextWindowTone(75)).toBe('warning');
    expect(contextWindowTone(89.9)).toBe('warning');
    expect(contextWindowTone(90)).toBe('critical');
    expect(contextWindowTone(100)).toBe('critical');
  });
});

describe('contextWindowDashOffset', () => {
  it('runs from an empty ring at 0 % to a closed ring at 100 %', () => {
    expect(contextWindowDashOffset(0)).toBeCloseTo(CONTEXT_RING_CIRCUMFERENCE);
    expect(contextWindowDashOffset(50)).toBeCloseTo(CONTEXT_RING_CIRCUMFERENCE / 2);
    expect(contextWindowDashOffset(100)).toBeCloseTo(0);
  });

  it('uses the circumference of the radius-8 ring', () => {
    expect(CONTEXT_RING_CIRCUMFERENCE).toBeCloseTo(2 * Math.PI * 8);
  });
});

describe('contextWindowTooltipLines', () => {
  it('states the share with one decimal and the token counts in German format', () => {
    expect(contextWindowTooltipLines({ total: 128000, used: 98304 })).toEqual(['Kontextfenster: 76.8% genutzt', 'Verbraucht: 98.304 / 128.000 Tokens']);
  });
});

describe('contextWindowAriaLabel', () => {
  it('names the rounded share', () => {
    expect(contextWindowAriaLabel(76.8)).toBe('Kontextfenster 77% genutzt');
    expect(contextWindowAriaLabel(60)).toBe('Kontextfenster 60% genutzt');
  });
});
