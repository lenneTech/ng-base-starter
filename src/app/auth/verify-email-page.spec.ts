/**
 * Renders the real `/auth/verify-email` page (verify-email-page.ts/.html with the real ng-base UI) and drives "send a
 * new e-mail" in every way it can go. Port of the Nuxt template's `tests/unit/pages/auth-verify-email.test.ts`.
 *
 * WHAT IT PINS
 *
 * From nest-server 12.6.0 on the verification link carries the token only, sealed, and no address. For a refused link
 * (expired, mostly) the page sends that token to `POST /iam/resend-verification-email`, and the API mails the address
 * it belongs to and answers it masked. Nobody types the address, and it never travels. `GET /iam/features` says
 * whether the API takes the token (`resendVerificationByToken`) and how long the resend waits
 * (`resendCooldownSeconds`). Without it the page goes on as against 12.5: the address from the link's `&email=` or
 * from login and sign-up, and an input field as the last resort. The token is verified without `callbackURL` (the
 * endpoint would answer 302), a refused token stays in the history entry, so a reload offers the new mail again, and a
 * dead link keeps a persistent message on the page rather than a toast that goes away.
 *
 * The round trip against a real API is `tests/e2e/auth-verify-email-url.spec.ts`. An expired token cannot be made
 * there, so the answer with a masked address, and the 429, are pinned here.
 *
 * HOW
 *
 * The page is routed by the real router (`RouterTestingHarness`), on the real `BrowserPlatformLocation`, so the state
 * the router writes lands in `window.history.state`, where the page reads and writes its memory. A reload is a
 * navigation that brings the previous entry's state along, as the router's initial navigation does. `LtAuthService`
 * and `LT_FETCH` are fakes with the contract of ng-base 22, nest-server 12.6.0 and Better Auth; toast and error
 * translation record what the page shows. The address form is the page's own Signal Form: the spec types into it and
 * presses its submit button, so the page's own schema decides. TestBed rethrows every application error, so a case
 * that throws fails; that is what the Nuxt cases check with `errors: []`.
 */
import { APP_BASE_HREF, BrowserPlatformLocation, PlatformLocation } from '@angular/common';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { LT_FETCH, LT_RUNTIME_CONFIG, LtApiUrlService, LtErrorTranslationService, LtToastService, type LtToastOptions } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';

import { VerifyEmailPage } from './verify-email-page';
import { recallVerifyEmail, verifyEmailState } from './verify-email-memory';

const API = 'http://api.test';
const RESEND = `${API}/iam/resend-verification-email`;
/** `https:`: `appUrl` takes a configured origin over plain `http:` only for loopback hosts. */
const SITE_URL = 'https://app.test';
/** Absolute, from `NG_PUBLIC_SITE_URL`: Better Auth would resolve a relative one against the API's origin. */
const CALLBACK_URL = `${SITE_URL}/auth/verify-email`;
const SEALED = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..aXY.Y2lwaGVy.dGFn';
/** Shaped like a sealed token, but nothing the API can open. */
const GARBLED = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..Z2FyYmxlZA.Z2FyYmxlZA.Z2FyYmxlZA';
/** Better Auth's own token from a mail sent before 12.6.0: its payload names the address and the user. */
const READABLE = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ email: 'max@test.com', userId: 'u1' })).toString('base64url')}.c2ln`;
const RATE_LIMIT_DE = 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.';

interface Options {
  /** `NG_PUBLIC_APP_ENV` as the runtime config carries it (`appEnv`); unset when absent. */
  appEnv?: string;
  /** What `GET /iam/features` answers; `null` lets the request fail. */
  features?: null | Record<string, unknown>;
  /** The URL query the page is opened with. */
  query?: Record<string, string>;
  /** What `POST /iam/resend-verification-email` answers (a body, or a whole `Response`), or throws. */
  resend?: (body: unknown) => Response | Record<string, unknown>;
  /** The history entry the page finds, as after a reload. */
  state?: Record<string, unknown>;
  /** What Better Auth's `verifyEmail` answers. */
  verify?: { data?: { status: boolean }; error?: { message?: string; status: number } };
}

/** As ng-base: the API's message from the response body wins over the thrown message. */
function translateError(error: unknown): string {
  const body = typeof error === 'object' && error !== null ? (error as { data?: { message?: unknown } }).data?.message : undefined;
  const message = typeof body === 'string' ? body : error instanceof Error ? error.message : String(error);
  return message.startsWith('#LTNS_0020') ? RATE_LIMIT_DE : message;
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

async function renderPage(options: Options = {}) {
  TestBed.resetTestingModule();
  const toasts: LtToastOptions[] = [];
  const features = signal<Record<string, unknown>>({});

  const verifyEmail = vi.fn(async (_params: { callbackURL?: string; token: string }) => options.verify ?? { data: { status: true } });
  const sendVerificationEmail = vi.fn(async (_params: { callbackURL?: string; email: string }) => ({ error: null }));
  const fetchFeatures = vi.fn(async () => {
    if (options.features === null) {
      throw new Error('offline');
    }
    const answer = { emailVerification: true, enabled: true, resendCooldownSeconds: 60, ...options.features };
    features.set(answer);
    return answer;
  });
  // The page sends JSON as a string body (`JSON.stringify`).
  const fetch = vi.fn(async (url: string, init?: { body?: string; headers?: Record<string, string>; method?: string }) => {
    if (url === RESEND && init?.method === 'POST') {
      const answer = options.resend ? options.resend(JSON.parse(init.body ?? 'null')) : { email: 'm***@test.com', success: true };
      return answer instanceof Response ? answer : Response.json(answer);
    }
    throw new Error(`unexpected request ${url}`);
  });

  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'auth/verify-email', component: VerifyEmailPage }]),
      // The browser's own history instead of TestBed's fake navigation: the page keeps its memory in `history.state`.
      { provide: PlatformLocation, useClass: BrowserPlatformLocation },
      { provide: APP_BASE_HREF, useValue: '/' },
      { provide: LtAuthService, useValue: { features, fetchFeatures, sendVerificationEmail, verifyEmail } },
      { provide: LtApiUrlService, useValue: { buildUrl: (path: string) => `${API}${path}` } },
      { provide: LT_FETCH, useValue: fetch },
      { provide: LT_RUNTIME_CONFIG, useValue: { apiUrl: API, siteUrl: SITE_URL, ...(options.appEnv === undefined ? {} : { appEnv: options.appEnv }) } },
      {
        provide: LtToastService,
        useValue: {
          show: (toast: LtToastOptions) => {
            toasts.push(toast);
            return true;
          },
        },
      },
      { provide: LtErrorTranslationService, useValue: { translateError } },
    ],
  });

  const router = TestBed.inject(Router);
  const harness = await RouterTestingHarness.create();
  const url = router.serializeUrl(router.createUrlTree(['/auth/verify-email'], { queryParams: options.query ?? {} }));
  // A reload: the router's initial navigation takes the history entry's state along.
  await router.navigateByUrl(url, { replaceUrl: true, ...(options.state ? { state: options.state } : {}) });
  await settle(harness.fixture);
  const root = harness.fixture.nativeElement as HTMLElement;

  /** The button whose label starts with `label`. */
  const button = (label: string) => [...root.querySelectorAll('button')].find((element) => element.textContent?.trim().startsWith(label));
  const form = (): HTMLFormElement | null => root.querySelector('form');
  const localNotice = () => [...root.querySelectorAll('lt-notice')].find((notice) => notice.textContent?.includes('Lokal ohne SMTP'));

  return {
    button,
    async click(label: string): Promise<void> {
      button(label)?.click();
      await settle(harness.fixture);
    },
    async clickResend(): Promise<void> {
      button('Neue E-Mail senden')?.click();
      await settle(harness.fixture);
    },
    fetchFeatures,
    form,
    /** Title and text of the notice that says where the link is locally, whitespace collapsed; `undefined` without one. */
    localHint: () => {
      const notice = localNotice();
      const part = (slot: string) => (notice?.querySelector(`[data-slot="${slot}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return notice ? { text: part('alert-description'), title: part('alert-title') } : undefined;
    },
    localNotice,
    memory: () => recallVerifyEmail(window.history.state),
    /** The query of the URL the router holds now. */
    query: () => router.parseUrl(router.url).queryParams,
    resendRequests: () =>
      fetch.mock.calls
        .filter(([requested]) => requested === RESEND)
        .map(([requested, init]) => [requested, { body: JSON.parse(init?.body ?? 'null') as unknown, method: init?.method }]),
    sendVerificationEmail,
    /** Types `email` into the address form, presses its submit button and returns the messages the field shows then. */
    async submit(email: string): Promise<string[]> {
      const input = form()?.querySelector<HTMLInputElement>('input#verify-email-address');
      if (!input) {
        throw new Error('no address form');
      }
      input.value = email;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await harness.fixture.whenStable();
      form()?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
      await settle(harness.fixture);
      return [...root.querySelectorAll('hlm-field-error')].map((error) => error.textContent?.trim() ?? '');
    },
    text: () => root.textContent ?? '',
    toasts,
    verifyEmail,
  };
}

afterEach(() => {
  window.history.replaceState(null, '');
});

const REFUSED = { error: { message: 'Token expired', status: 401 } };
const BY_TOKEN = { resendVerificationByToken: true };

describe('verify-email against nest-server 12.6.0+ (the API takes the token)', () => {
  it('asks for a new mail with the refused token alone and shows the address the API masked', async () => {
    const page = await renderPage({ features: BY_TOKEN, query: { token: SEALED }, verify: REFUSED });

    expect(page.text()).toContain('Verifizierung fehlgeschlagen');
    expect(page.query()).toEqual({});
    // Verified without `callbackURL`: with one, the endpoint answers 302 instead of JSON.
    expect(page.verifyEmail).toHaveBeenCalledExactlyOnceWith({ token: SEALED });

    await page.clickResend();

    expect(page.resendRequests()).toEqual([[RESEND, { body: { token: SEALED }, method: 'POST' }]]);
    expect(page.sendVerificationEmail).not.toHaveBeenCalled();
    expect(page.text()).toContain('m***@test.com');
    expect(page.toasts.at(-1)).toMatchObject({ color: 'success', title: 'E-Mail gesendet' });
    // The answer is the same for an account that is verified already, so the page promises nothing.
    expect(page.toasts.at(-1)?.description).toContain('Falls dein Konto noch nicht bestätigt ist');
    expect(page.button('Neue E-Mail senden (60s)')?.disabled).toBe(true);
  });

  it('keeps the refused token in the history entry, and a reload offers the new mail without asking again', async () => {
    const first = await renderPage({ features: BY_TOKEN, query: { token: SEALED }, verify: REFUSED });
    expect(first.memory()).toEqual({ deadToken: SEALED, email: '', verified: false });
    const state = window.history.state as Record<string, unknown>;

    const reloaded = await renderPage({ features: BY_TOKEN, state });

    expect(reloaded.verifyEmail).not.toHaveBeenCalled();
    expect(reloaded.text()).toContain('Verifizierung fehlgeschlagen');
    await reloaded.clickResend();
    expect(reloaded.resendRequests()).toEqual([[RESEND, { body: { token: SEALED }, method: 'POST' }]]);
  });

  it('asks for the address when the API cannot read the token, forgets the token, and keeps the typed address to the form', async () => {
    const page = await renderPage({ features: BY_TOKEN, query: { token: GARBLED }, resend: () => ({ email: null, success: true }), verify: REFUSED });
    expect(page.memory().deadToken).toBe(GARBLED);

    await page.clickResend();

    expect(page.toasts.at(-1)).toMatchObject({ color: 'error', title: 'Link nicht erkannt' });
    expect(page.memory().deadToken).toBe('');
    expect(page.form()).not.toBeNull();
    expect((await page.submit('not-an-address'))[0]).toBe('Bitte gib eine gültige E-Mail-Adresse ein.');
    expect(await page.submit(' max@test.com ')).toEqual([]);
    expect(page.sendVerificationEmail).toHaveBeenCalledWith({ callbackURL: CALLBACK_URL, email: 'max@test.com' });
    // The typed address goes neither into the URL nor into the history entry.
    expect(page.query()).toEqual({});
    expect(JSON.stringify(window.history.state)).not.toContain('max@test.com');
    expect(page.form()).not.toBeNull();
  });

  it('shows only the address the API masked, never one read from the token', async () => {
    // A readable token names the address in full; the page must not show it, or anything built from it.
    const page = await renderPage({ features: BY_TOKEN, query: { token: READABLE }, resend: () => ({ email: 'x***@example.org', success: true }), verify: REFUSED });

    await page.clickResend();

    expect(page.text()).toContain('x***@example.org');
    expect(page.text()).not.toContain('max@test.com');
    expect(page.text()).not.toContain('m***@test.com');
  });

  it('asks for a new mail with a readable token too, but keeps it out of the history entry', async () => {
    const page = await renderPage({ features: BY_TOKEN, query: { token: READABLE }, verify: REFUSED });

    expect(JSON.stringify(window.history.state)).not.toContain(READABLE);
    expect(page.memory().deadToken).toBe('');
    await page.clickResend();
    expect(page.resendRequests()).toEqual([[RESEND, { body: { token: READABLE }, method: 'POST' }]]);
  });

  it('shows the translated 429 when the link has asked too often', async () => {
    const page = await renderPage({
      features: BY_TOKEN,
      query: { token: SEALED },
      resend: () => Response.json({ message: '#LTNS_0020: Too many requests', statusCode: 429 }, { status: 429 }),
      verify: REFUSED,
    });

    await page.clickResend();

    expect(page.toasts.at(-1)).toEqual({ color: 'error', description: RATE_LIMIT_DE, title: 'Fehler' });
    expect(page.memory().deadToken).toBe(SEALED);
  });

  it('shows no transport line when the request does not reach the API', async () => {
    const page = await renderPage({
      features: BY_TOKEN,
      query: { token: SEALED },
      resend: () => {
        throw new TypeError('Failed to fetch');
      },
      verify: REFUSED,
    });

    await page.clickResend();

    expect(page.toasts.at(-1)?.description).toBe('Die E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.');
  });

  it('keeps no token when the API failed rather than refused the link', async () => {
    const page = await renderPage({ features: BY_TOKEN, query: { token: SEALED }, verify: { error: { message: 'Internal Server Error', status: 500 } } });

    expect(page.memory().deadToken).toBe('');
    expect(page.form()).not.toBeNull();
  });

  it('remembers an accepted link, and no token', async () => {
    const page = await renderPage({ features: BY_TOKEN, query: { token: SEALED } });

    expect(page.text()).toContain('E-Mail bestätigt');
    expect(page.memory()).toEqual({ deadToken: '', email: '', verified: true });
  });
});

describe('verify-email against a server before 12.6.0 (no resend by token)', () => {
  // As the Nuxt template 2.37.0 against nest-server 12.5: the address of the link or of login and sign-up, Better
  // Auth's own resend, no request to the new endpoint, no token in the history entry.
  it.each([
    ['a sealed token', SEALED],
    ['a readable token', READABLE],
  ])('sends the new mail to the address of the link with %s, as before, and keeps no token', async (_label, linkToken) => {
    const page = await renderPage({ query: { email: 'max@test.com', token: linkToken }, verify: REFUSED });

    expect(page.query()).toEqual({});
    expect(page.memory()).toEqual({ deadToken: '', email: 'max@test.com', verified: false });
    expect(page.form()).toBeNull();
    await page.clickResend();

    expect(page.resendRequests()).toEqual([]);
    expect(page.sendVerificationEmail).toHaveBeenCalledWith({ callbackURL: CALLBACK_URL, email: 'max@test.com' });
    expect(page.toasts.at(-1)).toMatchObject({ color: 'success', description: 'Eine neue Bestätigungs-E-Mail wurde gesendet.' });
  });

  it('offers the resend to the address login or sign-up handed over, as before', async () => {
    const page = await renderPage({ query: { fromRegister: 'true' }, state: verifyEmailState('max@test.com') });

    expect(page.text()).toContain('max@test.com');
    // The cooldown of `GET /iam/features` (`resendCooldownSeconds`), started because sign-up has just sent a mail.
    expect(page.button('Bestätigungs-E-Mail erneut senden (60s)')?.disabled).toBe(true);
    expect(page.form()).toBeNull();
    expect(page.resendRequests()).toEqual([]);
  });

  it('falls back to the address when the features cannot be read', async () => {
    const page = await renderPage({ features: null, query: { token: SEALED }, verify: REFUSED });

    expect(page.memory().deadToken).toBe('');
    expect(page.form()).not.toBeNull();
  });
});

describe('verify-email without a link', () => {
  it('offers the resend to the address login or sign-up handed over', async () => {
    const page = await renderPage({ features: BY_TOKEN, state: verifyEmailState('max@test.com') });

    expect(page.text()).toContain('max@test.com');
    expect(page.form()).toBeNull();
    await page.click('Bestätigungs-E-Mail erneut senden');
    expect(page.sendVerificationEmail).toHaveBeenCalledWith({ callbackURL: CALLBACK_URL, email: 'max@test.com' });
  });

  it('asks for the address when it knows none', async () => {
    const page = await renderPage({ features: BY_TOKEN });

    expect(page.form()).not.toBeNull();
    // The field shows the first message of its schema.
    expect((await page.submit(''))[0]).toBe('Bitte gib deine E-Mail-Adresse ein.');
  });
});

describe('verify-email on a local stage, where the API sends no mail (DEV-4131)', () => {
  // Without SMTP the link stands only in the API terminal, in the log line `[EMAIL VERIFICATION]`. The page says so on
  // `NG_PUBLIC_APP_ENV=local` alone (what `.env.example` sets), and stays as it is on every other stage.
  const HINT = { text: 'Den Bestätigungslink findest du im API-Terminal unter [EMAIL VERIFICATION].', title: 'Lokal ohne SMTP' };

  it('says where the link is while the page waits for the mail, and still after a new one was sent', async () => {
    const page = await renderPage({ appEnv: 'local', features: BY_TOKEN, state: verifyEmailState('max@test.com') });

    expect(page.text()).toContain('E-Mail bestätigen');
    expect(page.localHint()).toEqual(HINT);
    await page.click('Bestätigungs-E-Mail erneut senden');
    expect(page.sendVerificationEmail).toHaveBeenCalledOnce();
    expect(page.localHint()).toEqual(HINT);
  });

  it('says it right after sign-up, and to a visitor it knows no address of', async () => {
    expect((await renderPage({ appEnv: 'local', query: { fromRegister: 'true' }, state: verifyEmailState('max@test.com') })).localHint()).toEqual(HINT);
    expect((await renderPage({ appEnv: 'local' })).localHint()).toEqual(HINT);
  });

  it('sets the name of the log line as code', async () => {
    const page = await renderPage({ appEnv: 'local' });

    expect(page.localNotice()?.querySelector('code')?.textContent).toBe('[EMAIL VERIFICATION]');
  });

  it.each([
    ['an accepted link', { query: { token: SEALED } }, 'E-Mail bestätigt'],
    ['a refused link', { features: BY_TOKEN, query: { token: SEALED }, verify: REFUSED }, 'Verifizierung fehlgeschlagen'],
  ])('says nothing about the terminal after %s', async (_label, options: Options, heading) => {
    const page = await renderPage({ appEnv: 'local', ...options });

    expect(page.text()).toContain(heading);
    expect(page.localHint()).toBeUndefined();
  });

  it.each([['production'], ['develop'], ['test'], [''], ['Local'], [undefined]])('stays as it is on the stage %j (fails closed)', async (appEnv) => {
    const page = await renderPage({ appEnv, features: BY_TOKEN, state: verifyEmailState('max@test.com') });

    expect(page.text()).toContain('E-Mail bestätigen');
    expect(page.text()).not.toContain('API-Terminal');
    expect(page.localHint()).toBeUndefined();
  });
});
