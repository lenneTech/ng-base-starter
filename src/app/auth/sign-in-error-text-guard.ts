import { type CanActivateFn, createUrlTreeFromSnapshot, RedirectCommand } from '@angular/router';

/**
 * Removes the provider's error text from the login URL before the page renders (the Nuxt template's
 * `sign-in-error-text.global.ts`).
 *
 * After a refused or silent sign-in through a social provider, Better Auth sends the browser to `errorCallbackURL`
 * (`/auth/login`) with `?error=<code>&error_description=<text>`. Microsoft puts a long text with trace and correlation
 * ids into the description. The page shows a fixed text for the code only, but a rendered request would still carry
 * the description: in the server's HTML (the router state), in the address bar and the history, and within reach of
 * analytics and the bug reporter. So the request goes, before anything renders, to the same route without that one
 * parameter: Angular's SSR engine answers a navigation that ended on another URL with a 302, the browser router
 * replaces the history entry. `error`, `redirect`, every other parameter and the fragment stay; the login page reads
 * the code once and removes `error` itself.
 *
 * On the login route after `guestGuard`: the router lets the first guard of the list that redirects win, so a
 * signed-in visitor still goes straight to the deep link.
 */
export const signInErrorTextGuard: CanActivateFn = (route) => {
  if (!('error_description' in route.queryParams)) {
    return true;
  }
  return new RedirectCommand(createUrlTreeFromSnapshot(route, [], withoutProviderErrorText(route.queryParams), route.fragment), { replaceUrl: true });
};

/**
 * The query without `error_description`, everything else kept (`error` and `redirect` above all).
 *
 * Here and not in `social-sign-in-error.ts`: the guard sits in `app.routes.ts` and so in the initial bundle of every
 * visitor, and an import from that file would take its German texts along.
 */
export function withoutProviderErrorText<T>(query: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(query).filter(([name]) => name !== 'error_description'));
}
