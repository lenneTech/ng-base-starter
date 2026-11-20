/**
 * `signInErrorTextGuard` removes the provider's `error_description` from the login URL before the page renders (Nuxt
 * template: `tests/unit/middleware/sign-in-error-text-global.test.ts`). On the server the redirect becomes a 302 of
 * Angular's SSR engine; `tests/e2e/auth-social-sign-in.spec.ts` checks the status and the served HTML.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, type CanActivateFn, provideRouter, RedirectCommand, Router, type RouterStateSnapshot } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../app.routes';
import { guestGuard } from './guest-guard';
import { signInErrorTextGuard, withoutProviderErrorText } from './sign-in-error-text-guard';

@Component({ selector: 'app-stub', template: '' })
class Stub {}

/** Navigates to `url` through the guard and returns where the router ended up. */
async function landAt(url: string): Promise<string> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'auth/login', canActivate: [signInErrorTextGuard], component: Stub },
        { path: 'auth/register', canActivate: [signInErrorTextGuard], component: Stub },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return TestBed.inject(Router).url;
}

/** The guard's own answer for `url`, with the snapshot the router built for it. */
async function answerFor(url: string): Promise<ReturnType<CanActivateFn>> {
  let snapshot: ActivatedRouteSnapshot | undefined;
  let state: RouterStateSnapshot | undefined;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'auth/login',
          canActivate: [
            (route: ActivatedRouteSnapshot, routerState: RouterStateSnapshot) => {
              snapshot = route;
              state = routerState;
              return true;
            },
          ],
          component: Stub,
        },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return TestBed.runInInjectionContext(() => signInErrorTextGuard(snapshot!, state!));
}

describe('signInErrorTextGuard', () => {
  it('redirects the login page without error_description, keeping error, redirect, the rest and the fragment', async () => {
    const url = await landAt('/auth/login?error=access_denied&error_description=AADSTS50058%20Trace%20ID&redirect=%2Fapp%2Fx&tab=2#top');

    expect(url).toBe('/auth/login?error=access_denied&redirect=%2Fapp%2Fx&tab=2#top');
  });

  it('also removes a description that came without a code', async () => {
    expect(await landAt('/auth/login?error_description=Ruf%20an&redirect=%2Fapp')).toBe('/auth/login?redirect=%2Fapp');
  });

  it('lets the cleaned URL through, so the redirect cannot loop', async () => {
    expect(await landAt('/auth/login?error=access_denied&redirect=%2Fapp')).toBe('/auth/login?error=access_denied&redirect=%2Fapp');
  });

  it('replaces the history entry instead of adding one', async () => {
    const answer = await answerFor('/auth/login?error=login_required&error_description=Text');

    expect(answer).toBeInstanceOf(RedirectCommand);
    const command = answer as RedirectCommand;
    expect(command.navigationBehaviorOptions).toEqual({ replaceUrl: true });
    expect(TestBed.inject(Router).serializeUrl(command.redirectTo)).toBe('/auth/login?error=login_required');
  });

  it('answers true for a URL without a description', async () => {
    expect(await answerFor('/auth/login?redirect=%2Fapp')).toBe(true);
  });

  it('runs after the guest guard on the login route, so a signed-in visitor still goes straight to the deep link', () => {
    const auth = routes[0]?.children?.find((route) => route.path === 'auth');
    const login = auth?.children?.find((route) => route.path === 'login');

    expect(login?.canActivate).toEqual([guestGuard, signInErrorTextGuard]);
  });
});

describe('withoutProviderErrorText', () => {
  it('removes only error_description, keeping error for the page', () => {
    expect(withoutProviderErrorText({ error: 'access_denied', error_description: 'Text', redirect: '/app/x' })).toEqual({ error: 'access_denied', redirect: '/app/x' });
  });
});
