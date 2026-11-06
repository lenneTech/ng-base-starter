import { Component, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, required, validateStandardSchema } from '@angular/forms/signals';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import { HlmButton, HlmDialogTitle, injectLtOverlayData, injectLtOverlayRef, LtFormField, LtPasswordInput } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopy, lucideKeyRound } from '@ng-icons/lucide';

import { fieldError } from '../shared/field-error';
import { confirmPasswordSchema, type PasswordModel } from './security-schemas';

/** What the security page hands to the dialog. */
export interface BackupCodesDialogData {
  /** Codes just created by enabling 2FA; empty to ask for the password and generate new ones. */
  initialCodes: string[];
}

/**
 * Backup codes in a dialog (`LtOverlayService.open`): shows and copies the codes of a fresh 2FA setup, or regenerates
 * them after the password is confirmed. Each code works once.
 */
@Component({
  imports: [FormField, FormRoot, HlmButton, HlmDialogTitle, LtFormField, LtPasswordInput, NgIcon],
  providers: [provideIcons({ lucideCopy, lucideKeyRound })],
  selector: 'app-backup-codes-dialog',
  templateUrl: './backup-codes-dialog.html',
})
export class BackupCodesDialog {
  private readonly auth = inject(LtAuthService);
  private readonly ref = injectLtOverlayRef<void>();
  private readonly errors = inject(LtErrorTranslationService);
  private readonly toast = inject(LtToastService);

  protected readonly backupCodes = signal<string[]>(injectLtOverlayData<BackupCodesDialogData>()?.initialCodes ?? []);
  protected readonly loading = signal(false);

  private readonly model = signal<PasswordModel>({ password: '' });
  protected readonly passwordForm = form(
    this.model,
    (path) => {
      required(path.password, { message: 'Passwort ist erforderlich' });
      validateStandardSchema(path, confirmPasswordSchema);
    },
    { name: 'backupCodes', submission: { action: async (field) => this.generate(field().value().password) } },
  );
  protected readonly fieldError = fieldError;

  protected async copy(): Promise<void> {
    await navigator.clipboard.writeText(this.backupCodes().join('\n'));
    this.toast.show({ color: 'success', description: 'Backup-Codes wurden in die Zwischenablage kopiert', title: 'Kopiert' });
  }

  protected close(): void {
    this.ref.close();
  }

  private async generate(password: string): Promise<undefined> {
    this.loading.set(true);
    try {
      const { data, error } = await this.auth.twoFactor.generateBackupCodes({ password });
      if (error) {
        this.toast.show({ color: 'error', description: this.errorText(error?.message, 'Backup-Codes konnten nicht generiert werden'), title: 'Fehler' });
        return undefined;
      }
      this.backupCodes.set((data as { backupCodes?: string[] } | null | undefined)?.backupCodes ?? []);
    } catch {
      this.toast.show({ color: 'error', description: 'Backup-Codes konnten gerade nicht generiert werden. Bitte versuche es später erneut.', title: 'Fehler' });
    } finally {
      this.loading.set(false);
    }
    return undefined;
  }

  /**
   * The text of a refused call: nest-server's `#LTNS_xxxx` message translated, otherwise the German fallback. Better
   * Auth's own 2FA answers ("Invalid code", "Invalid password") carry no code; `translateError` would hand them back
   * unchanged, in English (auth rule 1: test the input, never `translateError(x) || fallback`).
   */
  private errorText(message: string | undefined, fallback: string): string {
    return message?.includes('#LTNS_') ? this.errors.translateError(message) : fallback;
  }
}
