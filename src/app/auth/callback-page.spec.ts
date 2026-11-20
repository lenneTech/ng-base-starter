/**
 * `/auth/callback`, the last step of a sign-in through a social provider (Nuxt template:
 * `tests/unit/pages/auth-callback.test.ts`).
 *
 * The page goes on to the deep link only when the session exists AND the auth state is in the `lt-auth-state` cookie,
 * where a reload reads it. Otherwise it returns to the login page with `error=session_missing`, which never starts a
 * silent attempt: a browser that refuses the cookie cannot loop through app, API and provider.
 */
import { Component, computed, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { LtAuthStateService, LtAuthStore } from '@lenne.tech/ng-base/auth/provide';

import { CallbackPage } from './callback-page';
import { guestGuard } from './guest-guard';
import { SIGNED_OUT_KEY, SILENT_ATTEMPTED_KEY } from './social-sign-in-marks';

const USER = { email: 'social@test.com', id: 'social-user-1', name: 'Social Test' };

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

interface Scenario {
  /** What `LtAuthStateService.readState()` finds in the cookie after the session check. */
  cookie?: { authMode: 'cookie'; user: typeof USER } | null;
  redirect?: unknown;
  /** What `validateSession()` answers; an `Error` is thrown. */
  session: boolean | Error;
}

async function finish({ cookie = { authMode: 'cookie', user: USER }, redirect, session }: Scenario) {
  const validateSession = vi.fn(async () => {
    if (session instanceof Error) {
      throw session;
    }
    return session;
  });
  const clearUser = vi.fn();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: LtAuthStore, useValue: { clearUser, validateSession } }, { provide: LtAuthStateService, useValue: { readState: () => cookie } }],
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(CallbackPage);
  if (redirect !== undefined) {
    fixture.componentRef.setInput('redirect', redirect);
  }
  await settle(fixture);
  return { clearUser, fixture, navigate, navigateByUrl, validateSession };
}

function setMarks(): void {
  sessionStorage.setItem(SILENT_ATTEMPTED_KEY, '1');
  localStorage.setItem(SIGNED_OUT_KEY, '1');
}

function marks(): (null | string)[] {
  return [sessionStorage.getItem(SILENT_ATTEMPTED_KEY), localStorage.getItem(SIGNED_OUT_KEY)];
}

describe('CallbackPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('goes to the deep link and clears the marks once the session is there', async () => {
    setMarks();
    const { navigate, navigateByUrl, validateSession } = await finish({ redirect: '/app/records/42', session: true });

    expect(validateSession).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/app/records/42', { replaceUrl: true });
    expect(navigate).not.toHaveBeenCalled();
    expect(marks()).toEqual([null, null]);
  });

  it('falls back to /app without a deep link', async () => {
    const { navigateByUrl } = await finish({ session: true });

    expect(navigateByUrl).toHaveBeenCalledWith('/app', { replaceUrl: true });
  });

  it('never goes to a foreign target from the query', async () => {
    for (const redirect of ['//evil.com', 'https://evil.com', '/\\evil.com', ['/app/a', '/app/b']]) {
      TestBed.resetTestingModule();
      const { navigateByUrl } = await finish({ redirect, session: true });
      expect(navigateByUrl).toHaveBeenCalledWith('/app', { replaceUrl: true });
    }
  });

  it('sends the visitor back to the login page with its own code when no session arrived, and keeps the marks', async () => {
    setMarks();
    const { navigate, navigateByUrl } = await finish({ redirect: '/app/records/42', session: false });

    expect(navigate).toHaveBeenCalledWith(['/auth/login'], { queryParams: { error: 'session_missing', redirect: '/app/records/42' }, replaceUrl: true });
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(marks()).toEqual(['1', '1']);
  });

  it('sends the visitor back when the session is there but the browser refused the auth-state cookie', async () => {
    setMarks();
    const { clearUser, navigate, navigateByUrl } = await finish({ cookie: null, session: true });

    expect(navigate).toHaveBeenCalledWith(['/auth/login'], { queryParams: { error: 'session_missing', redirect: '/app' }, replaceUrl: true });
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(marks()).toEqual(['1', '1']);
    // The in-memory user goes before the navigation, or `guestGuard` would send the visitor on to the deep link.
    expect(clearUser).toHaveBeenCalledTimes(1);
    expect(clearUser.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0] ?? 0);
  });

  it('keeps the user of a completed sign-in', async () => {
    const { clearUser } = await finish({ session: true });

    expect(clearUser).not.toHaveBeenCalled();
  });

  it('treats a failed session check as no session', async () => {
    const { navigate } = await finish({ redirect: '//evil.com', session: new Error('network down') });

    expect(navigate).toHaveBeenCalledWith(['/auth/login'], { queryParams: { error: 'session_missing', redirect: '/app' }, replaceUrl: true });
  });

  it('tells screen readers what it is doing', async () => {
    const { fixture } = await finish({ session: true });

    const status = (fixture.nativeElement as HTMLElement).querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe('Anmeldung wird abgeschlossen …');
  });
});

@Component({ selector: 'app-stub', template: '' })
class Stub {}

/**
 * The failure path through the real router and the real `guestGuard`. `validateSession()` puts the user into the store
 * (in memory) even when the browser refuses the `lt-auth-state` cookie, and `guestGuard` reads that memory: without
 * clearing it, the way back to the login page was turned into the deep link, the visitor was in the app until the next
 * reload, and `session_missing` was never shown.
 */
describe('CallbackPage: the way back to the login page passes the guest guard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('lands on the login page with session_missing although the session check put the user into memory', async () => {
    const user = signal<null | typeof USER>(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'auth/callback', component: CallbackPage },
            { path: 'auth/login', canActivate: [guestGuard], component: Stub },
            { path: '**', component: Stub },
          ],
          withComponentInputBinding(),
        ),
        {
          provide: LtAuthStore,
          useValue: {
            clearUser: () => user.set(null),
            isAuthenticated: computed(() => !!user()),
            validateSession: async () => {
              user.set(USER);
              return true;
            },
          },
        },
        // The browser refused the cookie: a reload would find nobody.
        { provide: LtAuthStateService, useValue: { readState: () => null } },
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/auth/callback?redirect=%2Fapp%2Frecords%2F42');
    for (let round = 0; round < 3; round++) {
      await new Promise((resolve) => setTimeout(resolve));
      await harness.fixture.whenStable();
    }

    expect(TestBed.inject(Router).url).toBe('/auth/login?error=session_missing&redirect=%2Fapp%2Frecords%2F42');
    expect(user()).toBeNull();
  });
});
