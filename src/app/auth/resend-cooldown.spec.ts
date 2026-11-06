import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { injectResendCooldown, resendCooldownSeconds } from './resend-cooldown';

@Component({ template: '' })
class Host {
  readonly cooldown = injectResendCooldown();
}

describe('injectResendCooldown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts down to zero and stops', () => {
    const { cooldown } = TestBed.createComponent(Host).componentInstance;
    cooldown.start(3);
    expect(cooldown.remaining()).toBe(3);
    vi.advanceTimersByTime(2000);
    expect(cooldown.remaining()).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(cooldown.remaining()).toBe(0);
  });

  it('clears its interval when the component is destroyed', () => {
    const fixture = TestBed.createComponent(Host);
    // Relative: Angular's own scheduler may hold timers of its own in the test environment.
    const before = vi.getTimerCount();
    fixture.componentInstance.cooldown.start(60);
    expect(vi.getTimerCount()).toBe(before + 1);
    fixture.destroy();
    expect(fixture.componentInstance.cooldown.remaining()).toBe(0);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(before);
  });
});

describe('resendCooldownSeconds', () => {
  it('takes the feature flag and falls back to 60', () => {
    expect(resendCooldownSeconds({ resendCooldownSeconds: 30 })).toBe(30);
    expect(resendCooldownSeconds({ resendCooldownSeconds: '30' })).toBe(60);
    expect(resendCooldownSeconds({})).toBe(60);
  });
});
