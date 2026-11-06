import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { LtAuthStore } from '@lenne.tech/ng-base/auth/provide';

import { safeRedirectTarget } from './safe-redirect-target';

/**
 * `/auth/login` for a signed-in visitor: straight on to where the login would have led (`?redirect=`, validated by
 * `safeRedirectTarget`, default `/app`). ng-base's `ltGuestGuard` takes a fixed target only; the deep link is the
 * starter's rule (Nuxt template `guest.global.ts`). Reads `LtAuthStore` from `/auth/provide`: the guard is in the initial
 * bundle, and `/auth` would bring the whole `LtAuthService` along.
 */
export const guestGuard: CanActivateFn = (route) => {
  if (!inject(LtAuthStore).isAuthenticated()) {
    return true;
  }
  return inject(Router).parseUrl(safeRedirectTarget(route.queryParamMap.get('redirect')));
};
