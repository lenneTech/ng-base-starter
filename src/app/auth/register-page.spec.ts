/**
 * `/auth/register` sends the visitor to the login when the API has nothing for this page (Nuxt template:
 * `app/pages/auth/register.vue`, the watcher on `signUpEnabled` and `emailAndPassword`).
 *
 * WHAT IT PINS
 *
 * - Sign-up closed (`signUpEnabled: false`): to the login, with the toast that says so.
 * - Sign-in through providers alone (`emailAndPassword: false`, nest-server 12.11.0+): to the login too, with a toast
 *   that points there; with sign-up open the account comes with the first sign-in through a provider.
 * - An API that reports neither (or not yet) leaves the visitor on the form.
 *
 * The redirect happens in the browser only (a server redirect is a bare 302 and would lose the toast); the server side
 * is checked in `tests/e2e/register-ssr-features.spec.ts` and `tests/e2e/auth-sign-in-methods.spec.ts`.
 */
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { LtErrorTranslationService, LtToastService, type LtToastOptions } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';

import { RegisterPage } from './register-page';

@Component({ selector: 'app-stub', template: '' })
class Stub {}

interface Options {
  /** The browser's own `/iam/features` answer, set once `refetchedArrives` resolves; default: no new answer. */
  refetched?: Record<string, unknown>;
  /** When the browser's answer arrives: after the page already showed its toast and started to leave. */
  refetchedArrives?: Promise<void>;
  /** Holds the navigation to the login (a lazy route still loading) until the test lets it go. */
  slowLogin?: Promise<boolean>;
}

async function openRegister(features: Record<string, unknown>, options: Options = {}) {
  const toasts: LtToastOptions[] = [];
  const featuresState = signal(features);
  const navigations: string[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'auth/register', component: RegisterPage },
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
  await harness.navigateByUrl('/auth/register');
  // Not `whenStable()`: a navigation held by `slowLogin` keeps the app unstable on purpose.
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 5; round++) {
      await new Promise((resolve) => setTimeout(resolve));
      harness.fixture.detectChanges();
    }
  };
  await settle();
  /** The page's own calls that send the visitor to the login, with their extras. */
  const toLogin = () => navigateByUrl.mock.calls.filter(([url]) => url === '/auth/login');
  return { navigations, settle, toLogin, toasts, url: () => router.url };
}

describe('RegisterPage: when the API has nothing for this page', () => {
  it('stays on the form for an API that reports sign-up open and does not report emailAndPassword', async () => {
    const page = await openRegister({ signUpEnabled: true });

    expect(page.url()).toBe('/auth/register');
    expect(page.toasts).toEqual([]);
  });

  it('sends the visitor to the login when sign-up is closed', async () => {
    const page = await openRegister({ signUpEnabled: false });

    expect(page.url()).toBe('/auth/login');
    expect(page.toasts).toEqual([{ color: 'warning', description: 'Die Registrierung ist derzeit deaktiviert.', title: 'Registrierung nicht verfügbar' }]);
  });

  it('replaces the history entry, so "Zurück" does not land on the page that sends the visitor away again', async () => {
    for (const features of [{ signUpEnabled: false }, { emailAndPassword: false, signUpEnabled: true }]) {
      TestBed.resetTestingModule();
      const page = await openRegister(features);

      expect(page.toLogin(), JSON.stringify(features)).toEqual([['/auth/login', { replaceUrl: true }]]);
    }
  });

  it('sends the visitor to the login when the API signs in through providers alone', async () => {
    const page = await openRegister({ emailAndPassword: false, signUpEnabled: true, socialProviders: ['github'] });

    expect(page.url()).toBe('/auth/login');
    expect(page.toasts).toEqual([
      {
        color: 'warning',
        description: 'Eine Registrierung mit E-Mail und Passwort ist hier nicht möglich. Bitte melde dich über die Anmeldeseite an.',
        title: 'Registrierung nicht verfügbar',
      },
    ]);
  });

  it('says it once and leaves once, also when the answer of the browser arrives before the login has loaded', async () => {
    let letLoginLoad!: (value: boolean) => void;
    const slowLogin = new Promise<boolean>((resolve) => (letLoginLoad = resolve));
    let answer!: () => void;
    const refetchedArrives = new Promise<void>((resolve) => (answer = resolve));
    const providersOnly = { emailAndPassword: false, signUpEnabled: true, socialProviders: ['github'] };
    const page = await openRegister(providersOnly, { refetched: { ...providersOnly }, refetchedArrives, slowLogin });
    expect(page.toasts).toHaveLength(1);

    // The browser's answer (a new object with the same values) while the login is still loading.
    answer();
    await page.settle();
    letLoginLoad(true);
    await page.settle();

    expect(page.toasts).toHaveLength(1);
    expect(page.navigations.filter((url) => url === '/auth/login')).toHaveLength(1);
    expect(page.url()).toBe('/auth/login');
  });
});
