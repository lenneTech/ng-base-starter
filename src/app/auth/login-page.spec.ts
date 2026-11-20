/**
 * `/auth/login` and sign-in through a social provider (Nuxt template: `tests/unit/pages/auth-login-social.test.ts`).
 *
 * WHAT IT PINS
 *
 * - One button per provider `/iam/features` lists; an interactive sign-in sends `prompt=select_account` and absolute
 *   callback URLs built from the app origin, a fixed path and the validated deep link, never from the raw query.
 * - `?error=` becomes a fixed German alert (`role="alert"`), read once and removed from the URL; the codes of a silent
 *   attempt without provider session show the form without a message.
 * - The silent attempt (`NG_PUBLIC_AUTH_SILENT_PROVIDER`): "Anmeldung wird geprüft …" instead of the form until the page
 *   knows whether it runs; once per tab, never after "Abmelden", never with an error in the URL, only for a listed
 *   provider; a mark, blocked storage, an unlisted provider, a failed `/iam/features` or three seconds without an answer
 *   show the form.
 * - Every completed sign-in on this page clears the marks; a refused one or a pending second factor keeps them.
 * - A page restored from the back/forward cache frees the buttons and the form.
 *
 * HOW
 *
 * The real page with the real ng-base UI, routed through `RouterTestingHarness` with the router input binding, so the
 * URL the page cleans is the router's. `LtAuthService` is a fake with a `features` signal; toast and error translation
 * record what the page shows. The marks live in jsdom's own `sessionStorage` and `localStorage`. The first paint the
 * server renders (JavaScript off) is checked in `tests/e2e/auth-social-sign-in.spec.ts`.
 */
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { LT_RUNTIME_CONFIG, LtErrorTranslationService, LtToastService, type LtToastOptions } from '@lenne.tech/ng-base';
import { type LtAuthResponse, LtAuthService, type LtPasskeyAuthResult, type LtSocialSignInParams } from '@lenne.tech/ng-base/auth';

import { LoginPage } from './login-page';
import { SIGNED_OUT_KEY, SILENT_ATTEMPTED_KEY } from './social-sign-in-marks';

@Component({ selector: 'app-stub', template: '' })
class Stub {}

const SITE = 'https://app.example.com';
const CHECKING = 'Anmeldung wird geprüft …';
const TO_PROVIDER: LtAuthResponse = { data: { redirect: true, url: 'https://login.provider.test/authorize' }, error: null };
const USER = { email: 'max@example.com', id: 'u1', name: 'Max' };

interface Options {
  /** What `/iam/features` holds when the page starts (transferred from the server); `{}` = not known yet. */
  features?: Record<string, unknown>;
  /** The answer of `fetchFeatures()`; it sets the features signal to it. Default: the start value, unchanged. */
  fetchFeatures?: () => Promise<Record<string, unknown> | undefined>;
  passkey?: () => Promise<LtPasskeyAuthResult>;
  signInEmail?: () => Promise<LtAuthResponse>;
  /** `NG_PUBLIC_AUTH_SILENT_PROVIDER`. */
  silent?: string;
  social?: (params: LtSocialSignInParams) => Promise<LtAuthResponse>;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

async function openLogin(url: string, options: Options = {}) {
  const features = signal<Record<string, unknown>>(options.features ?? {});
  const toasts: LtToastOptions[] = [];
  const fetchFeatures = vi.fn(async () => {
    const answer = options.fetchFeatures ? await options.fetchFeatures() : undefined;
    if (answer) {
      features.set(answer);
    }
    return features();
  });
  const social = vi.fn(options.social ?? (async () => TO_PROVIDER));
  const signInEmail = vi.fn(options.signInEmail ?? (async (): Promise<LtAuthResponse> => ({ data: { user: USER }, error: null })));
  const authenticateWithPasskey = vi.fn(options.passkey ?? (async (): Promise<LtPasskeyAuthResult> => ({ success: true, user: USER })));

  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [
          { path: 'auth/login', component: LoginPage },
          { path: '**', component: Stub },
        ],
        withComponentInputBinding(),
      ),
      {
        provide: LtAuthService,
        useValue: {
          authenticateWithPasskey,
          features,
          fetchFeatures,
          setUser: vi.fn(),
          signIn: { email: signInEmail, social },
          validateSession: vi.fn(async () => true),
        },
      },
      { provide: LT_RUNTIME_CONFIG, useValue: { authSilentProvider: options.silent ?? '', siteUrl: SITE } },
      { provide: LtErrorTranslationService, useValue: { translateError: (message: string) => `übersetzt: ${message}` } },
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
  await harness.navigateByUrl(url, LoginPage);
  const fixture = harness.fixture;
  const root = fixture.nativeElement as HTMLElement;

  const settle = async (): Promise<void> => {
    for (let round = 0; round < 3; round++) {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    }
  };
  await settle();

  const buttons = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('lt-page-card [ltPageCardFooter] button')];
  const button = (name: string): HTMLButtonElement => {
    const found = buttons().find((candidate) => candidate.textContent?.trim() === name);
    if (!found) {
      throw new Error(`no button "${name}" in ${JSON.stringify(buttons().map((candidate) => candidate.textContent?.trim()))}`);
    }
    return found;
  };

  return {
    alert: () => root.querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    authenticateWithPasskey,
    /** The names of the buttons below the form, in order. */
    buttonNames: () => buttons().map((candidate) => candidate.textContent?.trim()),
    button,
    /** Whether the card with form and buttons is hidden (`hidden`: not visible, not focusable). */
    cardHidden: () => root.querySelector('lt-page-card')?.hasAttribute('hidden') ?? null,
    async click(name: string): Promise<void> {
      button(name).click();
      await settle();
    },
    features,
    fetchFeatures,
    router,
    settle,
    signInEmail,
    social,
    status: () => root.querySelector('p[role="status"]')?.textContent?.trim() ?? null,
    async submit(): Promise<void> {
      for (const [id, value] of [
        ['login-email', 'max@example.com'],
        ['login-password', 'Passw0rd!long'],
      ]) {
        const input = root.querySelector<HTMLInputElement>(`input#${id}`);
        if (!input) {
          throw new Error(`no input #${id}`);
        }
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await fixture.whenStable();
      root.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
      await settle();
    },
    text: () => root.textContent?.replace(/\s+/g, ' ') ?? '',
    toasts,
  };
}

function marks(): (null | string)[] {
  return [sessionStorage.getItem(SILENT_ATTEMPTED_KEY), localStorage.getItem(SIGNED_OUT_KEY)];
}

function setMarks(): void {
  sessionStorage.setItem(SILENT_ATTEMPTED_KEY, '1');
  localStorage.setItem(SIGNED_OUT_KEY, '1');
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LoginPage: a button per provider', () => {
  it('shows one button per provider /iam/features lists, before the passkey button', async () => {
    const page = await openLogin('/auth/login', { features: { socialProviders: ['microsoft', 'github'] } });

    expect(page.buttonNames()).toEqual(['Mit Microsoft anmelden', 'Mit GitHub anmelden', 'Mit Passkey anmelden']);
  });

  it('shows none while the API lists none', async () => {
    const page = await openLogin('/auth/login', { features: { signUpEnabled: true } });

    expect(page.buttonNames()).toEqual(['Mit Passkey anmelden']);
  });

  it('shows the buttons once the features the page fetched list providers', async () => {
    const page = await openLogin('/auth/login', { fetchFeatures: async () => ({ socialProviders: ['github'] }) });

    expect(page.buttonNames()).toEqual(['Mit GitHub anmelden', 'Mit Passkey anmelden']);
  });

  it('starts an interactive sign-in with absolute URLs built from the validated deep link', async () => {
    const page = await openLogin('/auth/login?redirect=%2Fapp%2Frecords%2F42', { features: { socialProviders: ['microsoft', 'github'] } });

    await page.click('Mit GitHub anmelden');

    expect(page.social).toHaveBeenCalledExactlyOnceWith({
      additionalParams: { prompt: 'select_account' },
      callbackURL: `${SITE}/auth/callback?redirect=%2Fapp%2Frecords%2F42`,
      errorCallbackURL: `${SITE}/auth/login?redirect=%2Fapp%2Frecords%2F42`,
      provider: 'github',
    });
    // The browser leaves for the provider: every provider button waits meanwhile.
    expect(page.button('Mit GitHub anmelden').disabled).toBe(true);
    expect(page.button('Mit Microsoft anmelden').disabled).toBe(true);
  });

  it('never puts a foreign target from the query into the URLs', async () => {
    const page = await openLogin('/auth/login?redirect=%2F%2Fevil.com', { features: { socialProviders: ['github'] } });

    await page.click('Mit GitHub anmelden');

    expect(page.social.mock.calls[0]?.[0]).toMatchObject({ callbackURL: `${SITE}/auth/callback?redirect=%2Fapp`, errorCallbackURL: `${SITE}/auth/login?redirect=%2Fapp` });
  });

  it('says so and frees the button when the API refuses to start', async () => {
    const page = await openLogin('/auth/login', {
      features: { socialProviders: ['github'] },
      social: async () => ({ data: null, error: { code: 'PROVIDER_NOT_FOUND', message: '#LTNS_0400: Provider not found', status: 404 } }),
    });

    await page.click('Mit GitHub anmelden');

    expect(page.toasts).toEqual([expect.objectContaining({ color: 'error', description: 'übersetzt: #LTNS_0400: Provider not found', title: 'Anmeldung fehlgeschlagen' })]);
    expect(page.button('Mit GitHub anmelden').disabled).toBe(false);
  });

  it('has its own text when the refusal carries no message, and when the request throws', async () => {
    const page = await openLogin('/auth/login', { features: { socialProviders: ['github'] }, social: async () => ({ data: null, error: { status: 503 } }) });
    await page.click('Mit GitHub anmelden');
    expect(page.toasts.at(-1)).toMatchObject({ description: 'Die Anmeldung ist gerade nicht möglich. Bitte versuche es später erneut.' });

    page.social.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await page.click('Mit GitHub anmelden');
    expect(page.toasts.at(-1)).toMatchObject({ description: 'Ein unerwarteter Fehler ist aufgetreten', title: 'Fehler' });
    expect(page.button('Mit GitHub anmelden').disabled).toBe(false);
  });
});

describe('LoginPage: back with ?error=', () => {
  it('shows the refusal as an alert, removes error from the URL, and keeps redirect', async () => {
    const page = await openLogin('/auth/login?error=access_denied&redirect=%2Fapp%2Fx', { features: { socialProviders: ['github'] } });

    expect(page.alert()).toContain('Kein Zugang');
    expect(page.alert()).toContain('Dieses Konto ist für diese Anwendung nicht freigeschaltet.');
    expect(page.router.url).toBe('/auth/login?redirect=%2Fapp%2Fx');
    expect(page.cardHidden()).toBe(false);
  });

  it('keeps the message after the URL is clean, and drops it when a new sign-in starts', async () => {
    const page = await openLogin('/auth/login?error=account_not_linked', { features: { socialProviders: ['github'] } });
    expect(page.router.url).toBe('/auth/login');
    expect(page.alert()).toContain('Anmeldung nicht möglich');

    await page.click('Mit GitHub anmelden');

    expect(page.alert()).toBeNull();
  });

  it('drops the message when a password sign-in starts', async () => {
    const page = await openLogin('/auth/login?error=access_denied');

    await page.submit();

    expect(page.alert()).toBeNull();
  });

  it('shows nothing after a silent attempt without a provider session, and cleans the URL', async () => {
    for (const code of ['login_required', 'interaction_required', 'consent_required', 'account_selection_required']) {
      TestBed.resetTestingModule();
      const page = await openLogin(`/auth/login?error=${code}&redirect=%2Fapp`);
      expect(page.alert()).toBeNull();
      expect(page.router.url).toBe('/auth/login?redirect=%2Fapp');
      expect(page.cardHidden()).toBe(false);
    }
  });

  it('never shows text from the query as the message', async () => {
    const page = await openLogin('/auth/login?error=Bitte%20rufe%200800%20123%20an');

    expect(page.alert()).toContain('Die Anmeldung wurde nicht abgeschlossen. Bitte versuche es erneut.');
    expect(page.text()).not.toContain('0800');
  });

  it('names the code the callback page sends when no session arrived', async () => {
    const page = await openLogin('/auth/login?error=session_missing&redirect=%2Fapp%2Fx');

    expect(page.alert()).toContain('Fehlercode: session_missing');
    expect(page.router.url).toBe('/auth/login?redirect=%2Fapp%2Fx');
  });

  it('asks to start again after an expired sign-in that came back without redirect, and falls back to /app', async () => {
    const page = await openLogin('/auth/login?error=state_not_found');
    expect(page.alert()).toContain('Anmeldung abgebrochen');
    expect(page.router.url).toBe('/auth/login');

    await page.submit();

    expect(page.router.url).toBe('/app');
  });

  it('leaves a URL without error alone', async () => {
    const page = await openLogin('/auth/login?redirect=%2Fapp%2Fx&tab=2');

    expect(page.router.url).toBe('/auth/login?redirect=%2Fapp%2Fx&tab=2');
    expect(page.alert()).toBeNull();
  });
});

describe('LoginPage: the silent attempt', () => {
  it('waits for the provider list, then runs once with prompt=none behind a status text', async () => {
    const answer = deferred<Record<string, unknown>>();
    const page = await openLogin('/auth/login?redirect=%2Fapp%2Fx', { fetchFeatures: () => answer.promise, silent: 'microsoft' });

    expect(page.status()).toBe(CHECKING);
    expect(page.cardHidden()).toBe(true);
    expect(page.social).not.toHaveBeenCalled();

    answer.resolve({ socialProviders: ['microsoft'] });
    await page.settle();

    expect(page.social).toHaveBeenCalledExactlyOnceWith({
      additionalParams: { prompt: 'none' },
      callbackURL: `${SITE}/auth/callback?redirect=%2Fapp%2Fx`,
      errorCallbackURL: `${SITE}/auth/login?redirect=%2Fapp%2Fx`,
      provider: 'microsoft',
    });
    expect(sessionStorage.getItem(SILENT_ATTEMPTED_KEY)).toBe('1');
    // The browser leaves for the provider: the checking state stays.
    expect(page.status()).toBe(CHECKING);
    expect(page.cardHidden()).toBe(true);
  });

  it('starts at once when the server already knew the provider list', async () => {
    const page = await openLogin('/auth/login', { features: { socialProviders: ['microsoft'] }, fetchFeatures: () => new Promise(() => undefined), silent: 'microsoft' });

    expect(page.social).toHaveBeenCalledTimes(1);
    expect(page.cardHidden()).toBe(true);
  });

  it('does not run again in the same tab, so a return without provider session cannot loop', async () => {
    sessionStorage.setItem(SILENT_ATTEMPTED_KEY, '1');
    const page = await openLogin('/auth/login', { features: { socialProviders: ['microsoft'] }, silent: 'microsoft' });

    expect(page.social).not.toHaveBeenCalled();
    expect(page.cardHidden()).toBe(false);
    expect(page.status()).toBe('');
  });

  it('does not run after an explicit sign-out', async () => {
    localStorage.setItem(SIGNED_OUT_KEY, '1');
    const page = await openLogin('/auth/login', { features: { socialProviders: ['microsoft'] }, silent: 'microsoft' });

    expect(page.social).not.toHaveBeenCalled();
    expect(page.cardHidden()).toBe(false);
  });

  it('does not run when the page was reached with an error, even after the URL is clean', async () => {
    const page = await openLogin('/auth/login?error=login_required', { features: { socialProviders: ['microsoft'] }, silent: 'microsoft' });

    expect(page.router.url).toBe('/auth/login');
    expect(page.social).not.toHaveBeenCalled();
    expect(page.cardHidden()).toBe(false);
    expect(sessionStorage.getItem(SILENT_ATTEMPTED_KEY)).toBeNull();
  });

  it('does not run for a provider the API does not list, and shows the form from the first render', async () => {
    const page = await openLogin('/auth/login', { features: { socialProviders: ['github'] }, silent: 'microsoft' });

    expect(page.social).not.toHaveBeenCalled();
    expect(page.cardHidden()).toBe(false);
    expect(page.buttonNames()).toEqual(['Mit GitHub anmelden', 'Mit Passkey anmelden']);
  });

  it('is off without NG_PUBLIC_AUTH_SILENT_PROVIDER', async () => {
    const page = await openLogin('/auth/login', { features: { socialProviders: ['microsoft'] } });

    expect(page.social).not.toHaveBeenCalled();
    expect(page.cardHidden()).toBe(false);
  });

  it('shows the form again when the API refuses to start the attempt, without a message', async () => {
    const page = await openLogin('/auth/login', {
      features: { socialProviders: ['microsoft'] },
      silent: 'microsoft',
      social: async () => ({ data: null, error: { message: 'Provider not found', status: 404 } }),
    });

    expect(page.social).toHaveBeenCalledTimes(1);
    expect(page.cardHidden()).toBe(false);
    expect(page.toasts).toEqual([]);
    expect(page.alert()).toBeNull();
  });

  it('shows the form when the attempt throws', async () => {
    const page = await openLogin('/auth/login', {
      features: { socialProviders: ['microsoft'] },
      silent: 'microsoft',
      social: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    expect(page.cardHidden()).toBe(false);
    expect(page.toasts).toEqual([]);
  });

  it('shows the form at once when /iam/features fails, and starts nothing when the list arrives later', async () => {
    const page = await openLogin('/auth/login', { fetchFeatures: async () => undefined, silent: 'microsoft' });

    expect(page.cardHidden()).toBe(false);

    page.features.set({ socialProviders: ['microsoft'] });
    await page.settle();

    expect(page.social).not.toHaveBeenCalled();
    expect(page.cardHidden()).toBe(false);
  });

  it('shows the form after the timeout when the features never arrive', async () => {
    // `shouldAdvanceTime`: the fake clock also follows the real one, which the page's rendering needs.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answer = deferred<Record<string, unknown>>();
    const page = await openLogin('/auth/login', { fetchFeatures: () => answer.promise, silent: 'microsoft' });
    expect(page.cardHidden()).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    await page.settle();
    expect(page.cardHidden()).toBe(true);

    await vi.advanceTimersByTimeAsync(1100);
    await page.settle();
    expect(page.cardHidden()).toBe(false);

    // Late features start nothing: the visitor may be typing by then.
    answer.resolve({ socialProviders: ['microsoft'] });
    await page.settle();
    expect(page.social).not.toHaveBeenCalled();
    expect(page.cardHidden()).toBe(false);
  });

  it('does not start when the "attempted" mark cannot be written', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      const page = await openLogin('/auth/login', { features: { socialProviders: ['microsoft'] }, silent: 'microsoft' });

      expect(page.social).not.toHaveBeenCalled();
      expect(page.cardHidden()).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('LoginPage: a successful sign-in clears the marks', () => {
  it('clears them after a password sign-in and goes to the deep link', async () => {
    setMarks();
    const page = await openLogin('/auth/login?redirect=%2Fapp%2Fx');

    await page.submit();

    expect(page.signInEmail).toHaveBeenCalledTimes(1);
    expect(marks()).toEqual([null, null]);
    expect(page.router.url).toBe('/app/x');
  });

  it('keeps them after a refused password sign-in', async () => {
    setMarks();
    const page = await openLogin('/auth/login', { signInEmail: async () => ({ data: null, error: { message: 'Invalid email or password', status: 401 } }) });

    await page.submit();

    expect(marks()).toEqual(['1', '1']);
  });

  it('keeps them while the password sign-in waits for the second factor', async () => {
    setMarks();
    const page = await openLogin('/auth/login', { signInEmail: async () => ({ data: { twoFactorRedirect: true }, error: null }) });

    await page.submit();

    expect(marks()).toEqual(['1', '1']);
  });

  it('clears them after a passkey sign-in', async () => {
    setMarks();
    const page = await openLogin('/auth/login');

    await page.click('Mit Passkey anmelden');

    expect(page.authenticateWithPasskey).toHaveBeenCalledTimes(1);
    expect(marks()).toEqual([null, null]);
  });

  it('keeps them after a failed passkey sign-in', async () => {
    setMarks();
    const page = await openLogin('/auth/login', { passkey: async () => ({ error: 'Abgelehnt', success: false }) });

    await page.click('Mit Passkey anmelden');

    expect(marks()).toEqual(['1', '1']);
  });
});

describe('LoginPage: back from the provider through the back/forward cache', () => {
  function pageShow(persisted: boolean): void {
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
  }

  it('frees the provider buttons when the page is restored', async () => {
    const page = await openLogin('/auth/login', { features: { socialProviders: ['github'] } });
    await page.click('Mit GitHub anmelden');
    expect(page.button('Mit GitHub anmelden').disabled).toBe(true);

    pageShow(true);
    await page.settle();

    expect(page.button('Mit GitHub anmelden').disabled).toBe(false);
  });

  it('shows the form again when the page is restored during the silent attempt, without a second attempt', async () => {
    const page = await openLogin('/auth/login', { features: { socialProviders: ['microsoft'] }, silent: 'microsoft' });
    expect(page.cardHidden()).toBe(true);

    pageShow(true);
    await page.settle();

    expect(page.cardHidden()).toBe(false);
    expect(page.social).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary page show alone', async () => {
    const page = await openLogin('/auth/login', { features: { socialProviders: ['microsoft'] }, silent: 'microsoft' });

    pageShow(false);
    await page.settle();

    expect(page.cardHidden()).toBe(true);
  });
});
