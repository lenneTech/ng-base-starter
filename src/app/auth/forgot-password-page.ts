import { afterNextRender, Component, type ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { form, FormField, FormRoot, required, validateStandardSchema } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { LT_RUNTIME_CONFIG, LtErrorTranslationService } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import { HlmButton, HlmInput, LtFormField, LtNotice, LtPageCard, LtPageCardFooter } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLock, lucideMailCheck } from '@ng-icons/lucide';

import { fieldError } from '../shared/field-error';
import { appUrl } from './app-origin';
import { forgotPasswordSchema, type ForgotPasswordModel } from './auth-schemas';
import { injectResendCooldown, resendCooldownSeconds } from './resend-cooldown';

/**
 * `/auth/forgot-password`: request a reset link.
 *
 * - `redirectTo` is an absolute app URL built from `NG_PUBLIC_SITE_URL` (`appUrl`); Better Auth resolves a relative one
 *   against the API origin and answers 403 INVALID_REDIRECT_URL for a foreign one.
 * - The confirmation does not reveal whether an account exists ("Falls ein Konto … existiert").
 * - Resend with the cooldown of `GET /iam/features`; "use another address" keeps the address for a quick edit.
 * - Errors stay on the page as an alert (a toast vanishes before it is read); focus moves to the success heading when
 *   the form is replaced, so keyboard and screen-reader users keep their place.
 */
@Component({
  imports: [FormField, FormRoot, HlmButton, HlmInput, LtFormField, LtNotice, LtPageCard, LtPageCardFooter, NgIcon, RouterLink],
  providers: [provideIcons({ lucideLock, lucideMailCheck })],
  selector: 'app-forgot-password-page',
  templateUrl: './forgot-password-page.html',
})
export class ForgotPasswordPage {
  private readonly auth = inject(LtAuthService);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly injector = inject(Injector);
  private readonly runtimeConfig = inject(LT_RUNTIME_CONFIG);
  private readonly successHeading = viewChild<ElementRef<HTMLElement>>('successHeading');

  protected readonly cooldown = injectResendCooldown();
  protected readonly emailSent = signal(false);
  protected readonly loading = signal(false);
  protected readonly resending = signal(false);
  protected readonly submitError = signal('');
  protected readonly submittedEmail = signal('');

  private readonly model = signal<ForgotPasswordModel>({ email: '' });
  protected readonly emailForm = form(
    this.model,
    (path) => {
      required(path.email, { message: 'E-Mail ist erforderlich' });
      validateStandardSchema(path, forgotPasswordSchema);
    },
    { name: 'forgotPassword', submission: { action: async (field) => this.request(field().value().email) } },
  );
  protected readonly fieldError = fieldError;

  constructor() {
    void this.auth.fetchFeatures();
  }

  private async requestResetLink(email: string): Promise<boolean> {
    const { error } = await this.auth.requestPasswordReset({ email, redirectTo: appUrl('/auth/reset-password', this.runtimeConfig.siteUrl) });
    if (error) {
      // Not `translateError(x) || fallback`: the fallback is unreachable, so the empty message is tested first.
      this.submitError.set(error.message ? this.errors.translateError(error.message) : 'Die Anfrage konnte nicht verarbeitet werden.');
      return false;
    }
    this.submitError.set('');
    return true;
  }

  private async request(email: string): Promise<undefined> {
    this.loading.set(true);
    this.submitError.set('');
    try {
      if (await this.requestResetLink(email)) {
        this.submittedEmail.set(email);
        this.emailSent.set(true);
        this.cooldown.start(resendCooldownSeconds(this.auth.features()));
        afterNextRender(() => this.successHeading()?.nativeElement.focus(), { injector: this.injector });
      }
    } catch {
      this.submitError.set('Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.');
    } finally {
      this.loading.set(false);
    }
    return undefined;
  }

  protected async resend(): Promise<void> {
    if (!this.submittedEmail() || this.cooldown.remaining() > 0) {
      return;
    }
    this.resending.set(true);
    try {
      if (await this.requestResetLink(this.submittedEmail())) {
        this.cooldown.start(resendCooldownSeconds(this.auth.features()));
      }
    } catch {
      this.submitError.set('Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.');
    } finally {
      this.resending.set(false);
    }
  }

  /** Back to the form with the address kept, so a typo costs one edit rather than a detour. */
  protected useDifferentEmail(): void {
    this.emailSent.set(false);
    this.submitError.set('');
    this.cooldown.stop();
  }
}
