import { afterNextRender, Component, computed, DestroyRef, DOCUMENT, inject, input, signal } from '@angular/core';
import { form, FormField, FormRoot, required, validateStandardSchema } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LT_RUNTIME_CONFIG, LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAuthService, type LtSocialSignInParams } from '@lenne.tech/ng-base/auth';
import { HlmButton, HlmInput, HlmSeparator, LtFormField, LtNotice, LtPageCard, LtPageCardFooter, LtPasswordInput } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideKeyRound, lucideUser } from '@ng-icons/lucide';

import { fieldError } from '../shared/field-error';
import { appUrl } from './app-origin';
import { loginSchema, type LoginModel } from './auth-schemas';
import { safeRedirectTarget } from './safe-redirect-target';
import {
  configuredSilentProvider,
  SILENT_SIGN_IN_FEATURES_TIMEOUT_MS,
  SOCIAL_PROVIDER_ICONS,
  silentSignInProvider,
  socialProviderDisplay,
  socialProvidersOf,
} from './social-providers';
import { hasSignInError, socialSignInError, withoutSignInError } from './social-sign-in-error';
import { injectSocialSignInMarks } from './social-sign-in-marks';
import { verifyEmailState } from './verify-email-memory';

/**
 * `/auth/login`: e-mail and password, a social provider, passkey, links to the password reset and the sign-up.
 *
 * - `?redirect=` survives the whole flow (2FA, e-mail verification and the provider's round trip included) and is
 *   validated by `safeRedirectTarget`, so a deep link shared in a chat lands where it pointed, never off-site.
 * - `LTNS_0023` (e-mail not verified) leads to `/auth/verify-email`; the address travels in the history entry, never
 *   in the URL (`verify-email-memory.ts`).
 * - Every backend error goes through the error translation; a request that failed without a message (API down)
 *   gets its own text instead of repeating the title.
 * - The form never submits natively, even before hydration (the guard `ltAngularRequestHandler` writes into every
 *   HTML response): a native GET would put the password into the URL.
 * - One button per social provider `/iam/features` lists (`social-providers.ts`); `/auth/callback` finishes the
 *   sign-in. `?error=` from the way back becomes a fixed text (`social-sign-in-error.ts`); `signInErrorTextGuard`
 *   removed `error_description` before the page rendered.
 * - With `NG_PUBLIC_AUTH_SILENT_PROVIDER` the page tries once per tab to sign in without interaction (`prompt=none`),
 *   never after "Abmelden" until the next completed sign-in (`social-sign-in-marks.ts`). Every completed sign-in on
 *   this page clears the marks.
 */
@Component({
  imports: [FormField, FormRoot, HlmButton, HlmInput, HlmSeparator, LtFormField, LtNotice, LtPageCard, LtPageCardFooter, LtPasswordInput, NgIcon, RouterLink],
  providers: [provideIcons({ lucideKeyRound, lucideUser, ...SOCIAL_PROVIDER_ICONS })],
  selector: 'app-login-page',
  templateUrl: './login-page.html',
})
export class LoginPage {
  /** `?redirect=` of the URL (router input binding). */
  readonly redirect = input<unknown>();

  protected readonly auth = inject(LtAuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly marks = injectSocialSignInMarks();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly runtimeConfig = inject(LT_RUNTIME_CONFIG);
  private readonly toast = inject(LtToastService);

  protected readonly loading = signal(false);
  protected readonly passkeyLoading = signal(false);
  /** The provider whose sign-in is starting; every provider button waits meanwhile. */
  protected readonly socialLoading = signal<null | string>(null);
  protected readonly signUpEnabled = computed(() => this.auth.features()['signUpEnabled'] !== false);

  private readonly model = signal<LoginModel>({ email: '', password: '' });
  protected readonly loginForm = form(
    this.model,
    (path) => {
      // `required` carries the metadata Signal Forms turns into the `required` attribute; Valibot validates.
      required(path.email, { message: 'E-Mail ist erforderlich' });
      required(path.password, { message: 'Passwort ist erforderlich' });
      validateStandardSchema(path, loginSchema);
    },
    {
      name: 'login',
      submission: { action: async (field) => this.signIn(field().value()) },
    },
  );
  protected readonly fieldError = fieldError;

  /** Where the whole sign-in flow ends. */
  private readonly redirectTarget = computed(() => safeRedirectTarget(this.redirect()));
  /** The redirect carried into an intermediate step (2FA, verification); empty when the visit had none. */
  private readonly redirectQuery = computed(() => (typeof this.redirect() === 'string' ? { redirect: this.redirectTarget() } : {}));

  // ── sign-in through a social provider ────────────────────────────────────────────────────────────────────────────
  /** The provider ids `/iam/features` lists; the server's answer first, the browser's own once it arrives. */
  private readonly socialProviders = computed(() => socialProvidersOf(this.auth.features()));
  /** One button per listed provider. */
  protected readonly socialButtons = computed(() => this.socialProviders().map((id) => ({ id, ...socialProviderDisplay(id) })));
  /** `NG_PUBLIC_AUTH_SILENT_PROVIDER`, known on the server too. */
  private readonly configuredSilent = configuredSilentProvider(this.runtimeConfig['authSilentProvider']);
  /** The provider for the silent attempt: the configured one, while the API lists it. */
  private readonly silentProvider = computed(() => silentSignInProvider(this.configuredSilent, this.socialProviders()));
  /** True once `/iam/features` has answered (on the server, transferred, or in the browser). */
  private readonly featuresArrived = computed(() => Object.keys(this.auth.features()).length > 0);

  /** The query the page was opened with. `error` is read once from it and then leaves the URL. */
  private readonly arrivedQuery = this.route.snapshot.queryParams;
  /** Reached with an `error`: the silent attempt never starts then, or it would loop. */
  private readonly arrivedWithError = hasSignInError(this.arrivedQuery);
  /**
   * Why the provider or Better Auth sent the browser back here (`?error=` on `errorCallbackURL`). Only the code is
   * mapped to a fixed text, which stays until the visitor starts a new sign-in.
   */
  protected readonly socialError = signal(socialSignInError(this.arrivedQuery['error']));

  /**
   * Where the silent attempt stands: `waiting` until the page knows whether it runs, `running` while it does, `off`
   * for the form. With the setting and no `error` in the URL the page starts in `waiting`, on the server too: both know
   * the runtime config and the query. What the server cannot know (the marks in browser storage) is decided after the
   * first render in the browser, and every way that rules the attempt out ends in `off`.
   */
  private readonly silentPhase = signal<'off' | 'running' | 'waiting'>(this.configuredSilent && !this.arrivedWithError ? 'waiting' : 'off');

  /**
   * "Anmeldung wird geprüft …" instead of the form, from the server's HTML on. While waiting, a provider list without
   * the provider already shows the form: the server fetches `/iam/features` before it renders and the browser starts
   * with the same answer, so both render the form then.
   */
  protected readonly silentChecking = computed(() => {
    const phase = this.silentPhase();
    if (phase !== 'waiting') {
      return phase === 'running';
    }
    return !this.featuresArrived() || this.silentProvider() !== null;
  });

  /** The fallback timer of the `waiting` phase. */
  private silentWaitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    void this.auth.fetchFeatures();

    afterNextRender(() => {
      const view = this.document.defaultView;
      view?.addEventListener('pageshow', this.onPageShow);
      this.destroyRef.onDestroy(() => {
        view?.removeEventListener('pageshow', this.onPageShow);
        clearTimeout(this.silentWaitTimer);
      });

      // The code is in `socialError` now, so it leaves the URL too: a reload must not bring the message back.
      // `redirect`, every other parameter and the fragment stay.
      if (this.arrivedWithError) {
        void this.router.navigate([], { preserveFragment: true, queryParams: withoutSignInError(this.arrivedQuery), relativeTo: this.route, replaceUrl: true });
      }

      if (this.silentPhase() === 'waiting') {
        void this.decideSilentSignIn();
      }
    });
  }

  private async signIn(credentials: LoginModel): Promise<undefined> {
    this.socialError.set(null);
    this.loading.set(true);
    try {
      const result = await this.auth.signIn.email({ email: credentials.email, password: credentials.password });
      if (result.error) {
        const message = result.error.message;
        if (message && (message.includes('LTNS_0023') || message.toLowerCase().includes('email verification required'))) {
          this.toast.show({ color: 'warning', description: 'Bitte bestätige zuerst deine E-Mail-Adresse.', title: 'E-Mail nicht verifiziert' });
          await this.router.navigate(['/auth/verify-email'], { queryParams: this.redirectQuery(), state: verifyEmailState(credentials.email) });
          return undefined;
        }
        this.toast.show({
          color: 'error',
          description: message ? this.errors.translateError(message) : 'Die Anmeldung ist gerade nicht möglich. Bitte versuche es später erneut.',
          title: 'Anmeldung fehlgeschlagen',
        });
        return undefined;
      }
      // Better Auth native answers `twoFactorRedirect`, nest-server's REST layer `requiresTwoFactor`. `signIn.email()`
      // has already gone on to `/auth/2fa` then, with this page's `?redirect=` (auth rule 6).
      const data = result.data;
      if (data && (data.twoFactorRedirect || data['requiresTwoFactor'] || data.redirect)) {
        return undefined;
      }
      if (data?.user) {
        // Signed in: a later visit after the session expired may try the silent sign-in again.
        this.marks.clear();
        await this.router.navigateByUrl(this.redirectTarget());
        return undefined;
      }
      this.toast.show({ color: 'error', description: 'Anmeldung fehlgeschlagen - keine Benutzerdaten erhalten', title: 'Fehler' });
    } catch {
      this.toast.show({ color: 'error', description: 'Ein unerwarteter Fehler ist aufgetreten', title: 'Fehler' });
    } finally {
      this.loading.set(false);
    }
    return undefined;
  }

  protected async signInWithPasskey(): Promise<void> {
    this.socialError.set(null);
    this.passkeyLoading.set(true);
    try {
      const result = await this.auth.authenticateWithPasskey();
      if (!result.success) {
        this.toast.show({ color: 'error', description: result.error || 'Passkey-Anmeldung fehlgeschlagen', title: 'Fehler' });
        return;
      }
      if (result.user) {
        this.auth.setUser(result.user);
      } else {
        await this.auth.validateSession();
      }
      // Signed in: a later visit after the session expired may try the silent sign-in again.
      this.marks.clear();
      await this.router.navigateByUrl(this.redirectTarget());
    } catch (error: unknown) {
      const description =
        error instanceof Error && error.name === 'NotAllowedError'
          ? 'Passkey-Authentifizierung wurde abgebrochen'
          : error instanceof Error
            ? error.message
            : 'Passkey-Anmeldung fehlgeschlagen';
      this.toast.show({ color: 'error', description, title: 'Fehler' });
    } finally {
      this.passkeyLoading.set(false);
    }
  }

  /**
   * Interactive sign-in: `prompt=select_account` lets the user pick or switch the account at the provider. On success
   * the browser leaves for the provider, so the buttons keep waiting.
   */
  protected async signInWithProvider(provider: string): Promise<void> {
    this.socialError.set(null);
    this.socialLoading.set(provider);
    try {
      const result = await this.auth.signIn.social(this.socialSignInParams(provider, 'select_account'));
      if (result?.error) {
        this.socialLoading.set(null);
        const message = result.error.message;
        this.toast.show({
          color: 'error',
          description: message ? this.errors.translateError(message) : 'Die Anmeldung ist gerade nicht möglich. Bitte versuche es später erneut.',
          title: 'Anmeldung fehlgeschlagen',
        });
      }
    } catch {
      this.socialLoading.set(null);
      this.toast.show({ color: 'error', description: 'Ein unerwarteter Fehler ist aufgetreten', title: 'Fehler' });
    }
  }

  /**
   * Parameters of a sign-in through `provider`. Both URLs are absolute app URLs built from the app origin
   * (`NG_PUBLIC_SITE_URL`), a fixed path and the validated deep link, never from raw query input. Better Auth appends
   * `?error=` to `errorCallbackURL`.
   */
  private socialSignInParams(provider: string, prompt: 'none' | 'select_account'): LtSocialSignInParams {
    const redirect = encodeURIComponent(this.redirectTarget());
    const siteUrl = this.runtimeConfig.siteUrl;
    return {
      additionalParams: { prompt },
      callbackURL: appUrl(`/auth/callback?redirect=${redirect}`, siteUrl),
      errorCallbackURL: appUrl(`/auth/login?redirect=${redirect}`, siteUrl),
      provider,
    };
  }

  /**
   * Decides in the browser whether the silent attempt runs; the server rendered `waiting` without knowing the marks.
   * The provider list is usually there already (the server fetched it before rendering). Otherwise the page waits for
   * `/iam/features`: `fetchFeatures()` resolves with the old list when the request failed, so a failure shows the form
   * at once; the timer covers an API that does not answer.
   */
  private async decideSilentSignIn(): Promise<void> {
    if (!this.marks.maySignInSilently()) {
      this.stopWaitingForSilentSignIn();
      return;
    }
    if (!this.featuresArrived()) {
      this.silentWaitTimer = setTimeout(() => this.stopWaitingForSilentSignIn(), SILENT_SIGN_IN_FEATURES_TIMEOUT_MS);
      await this.auth.fetchFeatures().catch(() => undefined);
    }
    const provider = this.silentProvider();
    if (provider) {
      await this.startSilentSignIn(provider);
    } else {
      this.stopWaitingForSilentSignIn();
    }
  }

  /**
   * Silent sign-in: `prompt=none` makes the provider answer without showing anything, signed in when the visitor has a
   * session there, otherwise back here with `?error=login_required` (or another code that means a page would be needed
   * at the provider). It starts only from `waiting` (never with an `error` in the URL, never after the page gave up
   * waiting). The "attempted" mark is set and read back before the request; without it the attempt does not start.
   */
  private async startSilentSignIn(provider: string): Promise<void> {
    if (this.silentPhase() !== 'waiting') {
      return;
    }
    if (!this.marks.maySignInSilently() || !this.marks.markSilentAttempt()) {
      this.stopWaitingForSilentSignIn();
      return;
    }
    clearTimeout(this.silentWaitTimer);
    this.silentPhase.set('running');
    try {
      const result = await this.auth.signIn.social(this.socialSignInParams(provider, 'none'));
      if (result?.error) {
        this.silentPhase.set('off');
      }
    } catch {
      // Nothing to tell the visitor, who did not ask for this attempt; the form takes over.
      this.silentPhase.set('off');
    }
  }

  /** No silent attempt in this page view: the form takes over. A running attempt is left alone. */
  private stopWaitingForSilentSignIn(): void {
    clearTimeout(this.silentWaitTimer);
    if (this.silentPhase() === 'waiting') {
      this.silentPhase.set('off');
    }
  }

  /** Back from the provider through the back/forward cache: the page is restored with buttons that never free up. */
  private readonly onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) {
      this.socialLoading.set(null);
      clearTimeout(this.silentWaitTimer);
      this.silentPhase.set('off');
    }
  };
}
