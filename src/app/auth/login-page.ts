import { Component, computed, inject, input, signal } from '@angular/core';
import { form, FormField, FormRoot, required, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import { HlmButton, HlmInput, HlmSeparator, LtFormField, LtPageCard, LtPageCardFooter, LtPasswordInput } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideKeyRound, lucideUser } from '@ng-icons/lucide';

import { fieldError } from '../shared/field-error';
import { loginSchema, type LoginModel } from './auth-schemas';
import { safeRedirectTarget } from './safe-redirect-target';
import { verifyEmailState } from './verify-email-memory';

/**
 * `/auth/login`: e-mail and password, passkey, links to the password reset and the sign-up.
 *
 * - `?redirect=` survives the whole flow (2FA and e-mail verification detours included) and is validated by
 *   `safeRedirectTarget`, so a deep link shared in a chat lands where it pointed, never off-site.
 * - `LTNS_0023` (e-mail not verified) leads to `/auth/verify-email`; the address travels in the history entry, never
 *   in the URL (`verify-email-memory.ts`).
 * - Every backend error goes through the error translation; a request that failed without a message (API down)
 *   gets its own text instead of repeating the title.
 * - The form never submits natively, even before hydration (the guard `ltAngularRequestHandler` writes into every
 *   HTML response): a native GET would put the password into the URL.
 */
@Component({
  imports: [FormField, FormRoot, HlmButton, HlmInput, HlmSeparator, LtFormField, LtPageCard, LtPageCardFooter, LtPasswordInput, NgIcon, RouterLink],
  providers: [provideIcons({ lucideKeyRound, lucideUser })],
  selector: 'app-login-page',
  templateUrl: './login-page.html',
})
export class LoginPage {
  /** `?redirect=` of the URL (router input binding). */
  readonly redirect = input<unknown>();

  protected readonly auth = inject(LtAuthService);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly router = inject(Router);
  private readonly toast = inject(LtToastService);

  protected readonly loading = signal(false);
  protected readonly passkeyLoading = signal(false);
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

  constructor() {
    void this.auth.fetchFeatures();
  }

  private async signIn(credentials: LoginModel): Promise<undefined> {
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
}
