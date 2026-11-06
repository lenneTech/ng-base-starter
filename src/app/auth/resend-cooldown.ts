import { DestroyRef, inject, signal, type Signal } from '@angular/core';

/** A running "send again" cooldown: seconds left, start and stop. */
export interface ResendCooldown {
  /** Seconds until the next send is allowed; 0 when allowed. */
  readonly remaining: Signal<number>;
  start(seconds: number): void;
  stop(): void;
}

/**
 * A resend cooldown bound to the injection context: the interval is cleared when the component goes. The length comes
 * from `GET /iam/features` → `resendCooldownSeconds` at the call site (default 60, the Nuxt template's rule A.9.8).
 */
export function injectResendCooldown(): ResendCooldown {
  const remaining = signal(0);
  let timer: null | ReturnType<typeof setInterval> = null;

  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    remaining.set(0);
  };

  inject(DestroyRef).onDestroy(stop);

  return {
    remaining: remaining.asReadonly(),
    start(seconds: number): void {
      stop();
      remaining.set(Math.max(0, Math.floor(seconds)));
      timer = setInterval(() => {
        remaining.update((value) => value - 1);
        if (remaining() <= 0) {
          stop();
        }
      }, 1000);
    },
    stop,
  };
}

/** `resendCooldownSeconds` of the feature flags, or the default of 60 seconds. */
export function resendCooldownSeconds(features: Record<string, unknown>): number {
  const value = features['resendCooldownSeconds'];
  return typeof value === 'number' && value >= 0 ? value : 60;
}
