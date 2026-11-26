/**
 * `/auth/forgot-password` sends the visitor to the login when the API signs in through providers alone (Nuxt template:
 * `app/pages/auth/forgot-password.vue`, the watcher on `emailAndPassword`).
 *
 * WHAT IT PINS
 *
 * - `emailAndPassword: false` (nest-server 12.11.0+): there is no password to reset, so the page goes to the login with
 *   the toast that says why, and replaces its history entry ("Zurück" must not land here again).
 * - An API that keeps e-mail and password, or does not report the field (before 12.11.0), leaves the form.
 * - Once: the browser's own answer, a new object with the same values, must not show a second toast or start a second
 *   navigation while the lazy login route still loads.
 *
 * The redirect happens in the browser only (a server redirect is a bare 302 and would lose the toast); the server side
 * is checked in `tests/e2e/auth-sign-in-methods.spec.ts`.
 */
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { LT_RUNTIME_CONFIG, LtErrorTranslationService, LtToastService, type LtToastOptions } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';

import { ForgotPasswordPage } from './forgot-password-page';

@Component({ selector: 'app-stub', template: '' })
class Stub {}

const UNAVAILABLE = {
  color: 'warning',
  description: 'Diese Anwendung nutzt keine Anmeldung mit Passwort. Bitte melde dich über die Anmeldeseite an.',
  title: 'Passwort zurücksetzen nicht verfügbar',
};

interface Options {
  /** The browser's own `/iam/features` answer, set once `refetchedArrives` resolves; default: no new answer. */
  refetched?: Record<string, unknown>;
  /** When the browser's answer arrives: after the page already showed its toast and started to leave. */
  refetchedArrives?: Promise<void>;
  /** Holds the navigation to the login (a lazy route still loading) until the test lets it go. */
  slowLogin?: Promise<boolean>;
}

async function openForgotPassword(features: Record<string, unknown>, options: Options = {}) {
  const toasts: LtToastOptions[] = [];
  const featuresState = signal(features);
  const navigations: string[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'auth/forgot-password', component: ForgotPasswordPage },
        { canActivate: [() => options.slowLogin ?? true], component: Stub, path: 'auth/login' },
        { path: '**', component: Stub },
      ]),
      {
        provide: LtAuthService,
        useValue: {
          features: featuresState,
          fetchFeatures: vi.fn(async () => {
            if (options.refetched) {
              await options.refetchedArrives;
              featuresState.set(options.refetched);
            }
            return featuresState();
          }),
        },
      },
      { provide: LT_RUNTIME_CONFIG, useValue: { siteUrl: 'https://app.example.com' } },
      { provide: LtErrorTranslationService, useValue: { translateError: (message: string) => message } },
      {
        provide: LtToastService,
        useValue: {
          show: (toast: LtToastOptions) => {
            toasts.push(toast);
            return true;
          },
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const router = TestBed.inject(Router);
  const navigateByUrl = vi.spyOn(router, 'navigateByUrl');
  router.events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      navigations.push(event.url);
    }
  });
  await harness.navigateByUrl('/auth/forgot-password');
  // Not `whenStable()`: a navigation held by `slowLogin` keeps the app unstable on purpose.
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 5; round++) {
      await new Promise((resolve) => setTimeout(resolve));
      harness.fixture.detectChanges();
    }
  };
  await settle();
  const root = harness.fixture.nativeElement as HTMLElement;
  return {
    hasForm: () => !!root.querySelector('form input[type="email"]'),
    navigations,
    settle,
    /** The page's own calls that send the visitor to the login, with their extras. */
    toLogin: () => navigateByUrl.mock.calls.filter(([url]) => url === '/auth/login'),
    toasts,
    url: () => router.url,
  };
}

describe('ForgotPasswordPage: when the API has no password to reset', () => {
  it('keeps the form for an API that keeps e-mail and password, or does not report the field', async () => {
    for (const features of [{ emailAndPassword: true }, { signUpEnabled: true }]) {
      TestBed.resetTestingModule();
      const page = await openForgotPassword(features);

      expect(page.url(), JSON.stringify(features)).toBe('/auth/forgot-password');
      expect(page.hasForm(), JSON.stringify(features)).toBe(true);
      expect(page.toasts).toEqual([]);
    }
  });

  it('sends the visitor to the login and says why when the API signs in through providers alone', async () => {
    const page = await openForgotPassword({ emailAndPassword: false, socialProviders: ['github'] });

    expect(page.url()).toBe('/auth/login');
    expect(page.toasts).toEqual([UNAVAILABLE]);
  });

  it('replaces the history entry, so "Zurück" does not land on the page that sends the visitor away again', async () => {
    const page = await openForgotPassword({ emailAndPassword: false, socialProviders: ['github'] });

    expect(page.toLogin()).toEqual([['/auth/login', { replaceUrl: true }]]);
  });

  it('says it once and leaves once, also when the answer of the browser arrives before the login has loaded', async () => {
    let letLoginLoad!: (value: boolean) => void;
    const slowLogin = new Promise<boolean>((resolve) => (letLoginLoad = resolve));
    let answer!: () => void;
    const refetchedArrives = new Promise<void>((resolve) => (answer = resolve));
    const providersOnly = { emailAndPassword: false, socialProviders: ['github'] };
    const page = await openForgotPassword(providersOnly, { refetched: { ...providersOnly }, refetchedArrives, slowLogin });
    expect(page.toasts).toHaveLength(1);

    answer();
    await page.settle();
    letLoginLoad(true);
    await page.settle();

    expect(page.toasts).toHaveLength(1);
    expect(page.navigations.filter((url) => url === '/auth/login')).toHaveLength(1);
    expect(page.url()).toBe('/auth/login');
  });
});
