import { isPlatformBrowser } from '@angular/common';
import { Component, computed, effect, inject, PLATFORM_ID, signal } from '@angular/core';
import { form, FormField, FormRoot, required, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import { HlmButton, HlmCheckbox, HlmInput, LtFormField, LtPageCard, LtPageCardFooter, LtPasswordInput } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideKeyRound, lucideUserPlus } from '@ng-icons/lucide';

import { fieldError } from '../shared/field-error';
import { type RegisterModel, registerSchema, registerWithTermsSchema } from './auth-schemas';
import { verifyEmailState } from './verify-email-memory';

/**
 * `/auth/register`: name, e-mail, password twice, and the terms checkbox while `features.signUpChecks` is on.
 *
 * The feature flags decide the form, so they are fetched during SSR: server and browser then render the same form
 * (no hydration mismatch, no checkbox popping in after load). With sign-up disabled the page sends the visitor to the
 * login, in the browser only, so the toast that explains it reaches them. After sign-up: e-mail verification when it
 * is on, otherwise an automatic sign-in and the offer to add a passkey.
 *
 * Registration is disabled in the API, never here: `betterAuth.emailAndPassword.disableSignUp: true` makes
 * `/iam/features` report `signUpEnabled: false`. Deleting this page instead leaves `POST /iam/sign-up/email` open to
 * anybody with a plain request (README, "No self sign-up?").
 */
@Component({
  imports: [FormField, FormRoot, HlmButton, HlmCheckbox, HlmInput, LtFormField, LtPageCard, LtPageCardFooter, LtPasswordInput, NgIcon, RouterLink],
  providers: [provideIcons({ lucideKeyRound, lucideUserPlus })],
  selector: 'app-register-page',
  templateUrl: './register-page.html',
})
export class RegisterPage {
  private readonly auth = inject(LtAuthService);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly router = inject(Router);
  private readonly toast = inject(LtToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly loading = signal(false);
  protected readonly passkeyLoading = signal(false);
  protected readonly showPasskeyPrompt = signal(false);
  protected readonly requireTerms = computed(() => this.auth.features()['signUpChecks'] === true);

  private readonly model = signal<RegisterModel>({ confirmPassword: '', email: '', name: '', password: '', termsAccepted: false });
  protected readonly registerForm = form(
    this.model,
    (path) => {
      required(path.name, { message: 'Name ist erforderlich' });
      required(path.email, { message: 'E-Mail ist erforderlich' });
      required(path.password, { message: 'Passwort ist erforderlich' });
      required(path.confirmPassword, { message: 'Passwortbestätigung ist erforderlich' });
      validateStandardSchema(path, () => (this.requireTerms() ? registerWithTermsSchema : registerSchema));
    },
    { name: 'register', submission: { action: async (field) => this.signUp(field().value()) } },
  );
  protected readonly fieldError = fieldError;
  protected readonly termsAccepted = computed(() => this.model().termsAccepted);

  constructor() {
    void this.auth.fetchFeatures();
    // Never on the server: a server-side redirect is a bare 302, and the toast explaining it would never arrive.
    effect(() => {
      if (this.isBrowser && this.auth.features()['signUpEnabled'] === false) {
        this.toast.show({ color: 'warning', description: 'Die Registrierung ist derzeit deaktiviert.', title: 'Registrierung nicht verfügbar' });
        void this.router.navigateByUrl('/auth/login');
      }
    });
  }

  /**
   * The terms checkbox is bound by hand: Spartan's checkbox is a ControlValueAccessor whose `checked` input the
   * `[formField]` interop resets on every click. The schema still validates `termsAccepted` with the rest of the form.
   */
  protected acceptTerms(checked: boolean): void {
    this.model.update((value) => ({ ...value, termsAccepted: checked }));
    this.registerForm.termsAccepted().markAsTouched();
  }

  private async signUp(input: RegisterModel): Promise<undefined> {
    this.loading.set(true);
    try {
      const signUpResult = await this.auth.signUp.email({
        email: input.email,
        name: input.name,
        password: input.password,
        ...(this.requireTerms() ? { termsAndPrivacyAccepted: true } : {}),
      });
      if (signUpResult.error) {
        const message = signUpResult.error.message;
        this.toast.show({
          color: 'error',
          description: message ? this.errors.translateError(message) : 'Die Registrierung ist gerade nicht möglich. Bitte versuche es später erneut.',
          title: 'Registrierung fehlgeschlagen',
        });
        return undefined;
      }

      // With e-mail verification the backend revokes the session; the frontend state goes too, so protected routes
      // stay closed until the address is confirmed.
      if (this.auth.features()['emailVerification']) {
        this.auth.clearUser();
        this.toast.show({ color: 'success', description: 'Bitte überprüfe dein Postfach und bestätige deine E-Mail-Adresse.', title: 'Konto erstellt!' });
        await this.router.navigate(['/auth/verify-email'], { queryParams: { fromRegister: 'true' }, state: verifyEmailState(input.email) });
        return undefined;
      }

      // A session is needed for the passkey registration.
      const signInResult = await this.auth.signIn.email({ email: input.email, password: input.password });
      if (signInResult.error) {
        this.toast.show({ color: 'success', description: 'Dein Konto wurde erstellt. Bitte melde dich an.', title: 'Willkommen!' });
        await this.router.navigateByUrl('/auth/login');
        return undefined;
      }
      this.toast.show({ color: 'success', description: 'Dein Konto wurde erfolgreich erstellt', title: 'Willkommen!' });
      this.showPasskeyPrompt.set(true);
    } catch {
      this.toast.show({ color: 'error', description: 'Die Registrierung ist gerade nicht möglich. Bitte versuche es später erneut.', title: 'Registrierung fehlgeschlagen' });
    } finally {
      this.loading.set(false);
    }
    return undefined;
  }

  protected async addPasskey(): Promise<void> {
    this.passkeyLoading.set(true);
    try {
      const result = await this.auth.registerPasskey('Mein Gerät');
      if (result.success) {
        this.toast.show({ color: 'success', description: 'Passkey wurde erfolgreich hinzugefügt', title: 'Erfolg' });
      } else {
        this.toast.show({ color: 'error', description: result.error || 'Passkey konnte nicht hinzugefügt werden', title: 'Fehler' });
      }
      await this.router.navigateByUrl('/app');
    } catch {
      this.toast.show({ color: 'error', description: 'Der Passkey konnte gerade nicht hinzugefügt werden. Bitte versuche es später erneut.', title: 'Fehler' });
    } finally {
      this.passkeyLoading.set(false);
    }
  }

  protected async skipPasskey(): Promise<void> {
    await this.router.navigateByUrl('/app');
  }
}
