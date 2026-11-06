import { Component, computed, inject, input, signal } from '@angular/core';
import { form, FormField, FormRoot, required, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import { HlmButton, HlmInput, LtFormField, LtPageCard } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideShieldCheck } from '@ng-icons/lucide';

import { fieldError } from '../shared/field-error';
import { twoFactorSchema, type TwoFactorModel } from './auth-schemas';
import { safeRedirectTarget } from './safe-redirect-target';

/**
 * `/auth/2fa`: the second step of a sign-in that started on `/auth/login`, with a TOTP code or a backup code.
 *
 * It completes the sign-in and therefore owns the final navigation and the deep link (`?redirect=`, forwarded by the
 * login page, validated by `safeRedirectTarget`). ng-base sets the user and the auth mode (cookie or JWT) itself once
 * a code is accepted, which the Nuxt page had to do by hand.
 */
@Component({
  imports: [FormField, FormRoot, HlmButton, HlmInput, LtFormField, LtPageCard, NgIcon, RouterLink],
  providers: [provideIcons({ lucideShieldCheck })],
  selector: 'app-two-factor-page',
  templateUrl: './two-factor-page.html',
})
export class TwoFactorPage {
  readonly redirect = input<unknown>();

  private readonly auth = inject(LtAuthService);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly router = inject(Router);
  private readonly toast = inject(LtToastService);

  protected readonly loading = signal(false);
  protected readonly useBackupCode = signal(false);
  private readonly redirectTarget = computed(() => safeRedirectTarget(this.redirect()));

  private readonly model = signal<TwoFactorModel>({ code: '' });
  protected readonly codeForm = form(
    this.model,
    (path) => {
      required(path.code, { message: 'Code ist erforderlich' });
      validateStandardSchema(path, twoFactorSchema);
    },
    { name: 'twoFactor', submission: { action: async (field) => this.verify(field().value().code) } },
  );
  protected readonly fieldError = fieldError;

  protected toggleBackupCode(): void {
    this.useBackupCode.update((value) => !value);
  }

  private async verify(code: string): Promise<undefined> {
    this.loading.set(true);
    try {
      const backup = this.useBackupCode();
      const result = backup ? await this.auth.twoFactor.verifyBackupCode({ code }) : await this.auth.twoFactor.verifyTotp({ code });
      if (result.error) {
        // Not `translateError(x) || fallback`: translateError returns its input when it cannot translate it. Better
        // Auth's own answers ("Invalid code") carry no `#LTNS_` code and get the German text instead.
        const message = result.error.message;
        this.toast.show({
          color: 'error',
          description: message?.includes('#LTNS_') ? this.errors.translateError(message) : backup ? 'Backup-Code ungültig' : 'Code ungültig',
          title: 'Bestätigung fehlgeschlagen',
        });
        return undefined;
      }
      await this.router.navigateByUrl(this.redirectTarget());
    } catch {
      this.toast.show({ color: 'error', description: 'Die Bestätigung ist gerade nicht möglich. Bitte versuche es später erneut.', title: 'Bestätigung fehlgeschlagen' });
    } finally {
      this.loading.set(false);
    }
    return undefined;
  }
}
