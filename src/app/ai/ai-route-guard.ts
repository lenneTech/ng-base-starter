import { inject, Injector } from '@angular/core';
import { type CanActivateChildFn, Router } from '@angular/router';

import { isAiRoute } from './ai-routes';

/**
 * `/app/**`: the AI pages exist only while the API runs its AI module (`GET /ai/status` 200; nest-server-starter has
 * it off by default). Loads the status once per app start; an AI route while the module is off goes to `/app`.
 *
 * `@lenne.tech/ng-base/ai` is imported on the first AI route only: the guard sits on every `/app` route, and a static
 * import would put the AI services into the initial bundle of every visitor.
 */
export const aiRouteGuard: CanActivateChildFn = async (_route, state) => {
  if (!isAiRoute(state.url.split(/[?#]/)[0] ?? '')) {
    return true;
  }
  const injector = inject(Injector);
  const router = inject(Router);
  const { LtAiStatusService } = await import('@lenne.tech/ng-base/ai');
  const status = injector.get(LtAiStatusService);
  await status.load();
  return status.enabled() ? true : router.parseUrl('/app');
};
