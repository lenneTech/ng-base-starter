import { afterNextRender, Component, type ElementRef, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { form, FormField, FormRoot, required, validateStandardSchema } from '@angular/forms/signals';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAuthService, type LtPasskey } from '@lenne.tech/ng-base/auth';
import { HlmBadge, HlmButton, HlmCardImports, HlmInput, LtFormField, LtNotice, LtOverlayService, LtPasswordInput } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFingerprint, lucideKeyRound, lucidePlus, lucideShieldCheck, lucideTrash, lucideUser } from '@ng-icons/lucide';
import QRCode from 'qrcode';

import { errorText } from '../shared/error-text';
import { fieldError } from '../shared/field-error';
import { BackupCodesDialog } from './backup-codes-dialog';
import { confirmPasswordSchema, type PasswordModel, totpCodeSchema, type TotpCodeModel } from './security-schemas';

/**
 * `/app/settings/security`: two-factor authentication (enable with password → QR code → code → backup codes, disable,
 * show or regenerate backup codes), passkeys (list, add with a name, delete) and the account's data.
 */
@Component({
  imports: [DatePipe, FormField, FormRoot, HlmBadge, HlmButton, HlmCardImports, HlmInput, LtFormField, LtNotice, LtPasswordInput, NgIcon],
  providers: [provideIcons({ lucideFingerprint, lucideKeyRound, lucidePlus, lucideShieldCheck, lucideTrash, lucideUser })],
  selector: 'app-security-page',
  templateUrl: './security-page.html',
})
export class SecurityPage {
  protected readonly auth = inject(LtAuthService);
  private readonly overlay = inject(LtOverlayService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly toast = inject(LtToastService);

  /** Where focus goes after the backup-codes dialog of a fresh activation closes (its trigger is gone by then). */
  private readonly twoFactorTitle = viewChild<ElementRef<HTMLElement>>('twoFactorTitle');

  protected readonly loading = signal(false);
  protected readonly showTotpSetup = signal(false);
  protected readonly show2FADisable = signal(false);
  /** The QR code of the TOTP URI as SVG (password managers read SVG more reliably than a raster image). */
  protected readonly qrCodeSvg = signal<SafeHtml | null>(null);
  private readonly backupCodes = signal<string[]>([]);

  protected readonly passkeys = signal<LtPasskey[]>([]);
  protected readonly passkeyLoading = signal(false);
  protected readonly showAddPasskey = signal(false);
  protected readonly newPasskeyName = signal('');

  private readonly enableModel = signal<PasswordModel>({ password: '' });
  protected readonly enableForm = form(
    this.enableModel,
    (path) => {
      required(path.password, { message: 'Passwort ist erforderlich' });
      validateStandardSchema(path, confirmPasswordSchema);
    },
    { name: 'enableTwoFactor', submission: { action: async (field) => this.enable2FA(field().value().password) } },
  );

  private readonly disableModel = signal<PasswordModel>({ password: '' });
  protected readonly disableForm = form(
    this.disableModel,
    (path) => {
      required(path.password, { message: 'Passwort ist erforderlich' });
      validateStandardSchema(path, confirmPasswordSchema);
    },
    { name: 'disableTwoFactor', submission: { action: async (field) => this.disable2FA(field().value().password) } },
  );

  private readonly totpModel = signal<TotpCodeModel>({ code: '' });
  protected readonly totpForm = form(
    this.totpModel,
    (path) => {
      required(path.code, { message: 'Code ist erforderlich' });
      validateStandardSchema(path, totpCodeSchema);
    },
    { name: 'totp', submission: { action: async (field) => this.verifyTotp(field().value().code) } },
  );
  protected readonly fieldError = fieldError;

  constructor() {
    // Browser only, like the Nuxt template's onMounted: the server render has no session cookie to send.
    afterNextRender(() => void this.loadPasskeys());
  }

  private async enable2FA(password: string): Promise<undefined> {
    this.loading.set(true);
    try {
      const { data, error } = await this.auth.twoFactor.enable({ password });
      if (error || !data?.totpURI) {
        this.toast.show({ color: 'error', description: this.errorText(error?.message, '2FA konnte nicht aktiviert werden'), title: 'Fehler' });
        return undefined;
      }
      this.backupCodes.set(data.backupCodes ?? []);
      // Generated locally from the TOTP URI by the `qrcode` package; no foreign markup reaches the DOM.
      const svg = await QRCode.toString(data.totpURI, { errorCorrectionLevel: 'M', margin: 2, type: 'svg', width: 200 });
      this.qrCodeSvg.set(this.sanitizer.bypassSecurityTrustHtml(svg));
      this.showTotpSetup.set(true);
      this.enableModel.set({ password: '' });
    } catch {
      this.toast.show({ color: 'error', description: '2FA konnte gerade nicht aktiviert werden. Bitte versuche es später erneut.', title: 'Fehler' });
    } finally {
      this.loading.set(false);
    }
    return undefined;
  }

  private async verifyTotp(code: string): Promise<undefined> {
    this.loading.set(true);
    try {
      const { error } = await this.auth.twoFactor.verifyTotp({ code });
      if (error) {
        this.toast.show({ color: 'error', description: this.errorText(error?.message, 'Code ungültig'), title: 'Fehler' });
        return undefined;
      }
      const user = this.auth.user();
      if (user) {
        this.auth.setUser({ ...user, twoFactorEnabled: true });
      }
      this.toast.show({ color: 'success', description: '2FA wurde erfolgreich aktiviert', title: 'Erfolg' });
      const codes = this.backupCodes();
      this.resetTotpSetup();
      await this.openBackupCodes(codes);
      this.twoFactorTitle()?.nativeElement.focus();
    } catch {
      this.toast.show({ color: 'error', description: 'Der Code konnte gerade nicht geprüft werden. Bitte versuche es später erneut.', title: 'Fehler' });
    } finally {
      this.loading.set(false);
    }
    return undefined;
  }

  private async disable2FA(password: string): Promise<undefined> {
    this.loading.set(true);
    try {
      const { error } = await this.auth.twoFactor.disable({ password });
      if (error) {
        this.toast.show({ color: 'error', description: this.errorText(error?.message, '2FA konnte nicht deaktiviert werden'), title: 'Fehler' });
        return undefined;
      }
      const user = this.auth.user();
      if (user) {
        this.auth.setUser({ ...user, twoFactorEnabled: false });
      }
      this.toast.show({ color: 'success', description: '2FA wurde deaktiviert', title: 'Erfolg' });
      this.show2FADisable.set(false);
      this.disableModel.set({ password: '' });
    } catch {
      this.toast.show({ color: 'error', description: '2FA konnte gerade nicht deaktiviert werden. Bitte versuche es später erneut.', title: 'Fehler' });
    } finally {
      this.loading.set(false);
    }
    return undefined;
  }

  protected resetTotpSetup(): void {
    this.showTotpSetup.set(false);
    this.totpModel.set({ code: '' });
    this.qrCodeSvg.set(null);
  }

  protected async openBackupCodes(codes: string[] = []): Promise<void> {
    await this.overlay.open(BackupCodesDialog, { data: { initialCodes: codes } }).closed;
  }

  private async loadPasskeys(): Promise<void> {
    try {
      const { data, error } = await this.auth.passkey.list();
      if (error) {
        console.error('Failed to load passkeys:', error);
        return;
      }
      this.passkeys.set(data ?? []);
    } catch {
      console.error('Failed to load passkeys');
    }
  }

  protected async addPasskey(): Promise<void> {
    const name = this.newPasskeyName().trim();
    if (!name) {
      this.toast.show({ color: 'error', description: 'Bitte gib einen Namen für den Passkey ein', title: 'Fehler' });
      return;
    }
    this.passkeyLoading.set(true);
    try {
      const result = await this.auth.registerPasskey(name);
      if (!result.success) {
        this.toast.show({ color: 'error', description: result.error || 'Passkey konnte nicht hinzugefügt werden', title: 'Fehler' });
        return;
      }
      this.toast.show({ color: 'success', description: 'Passkey wurde erfolgreich hinzugefügt', title: 'Erfolg' });
      this.cancelAddPasskey();
      await this.loadPasskeys();
    } catch {
      this.toast.show({ color: 'error', description: 'Der Passkey konnte gerade nicht hinzugefügt werden. Bitte versuche es später erneut.', title: 'Fehler' });
    } finally {
      this.passkeyLoading.set(false);
    }
  }

  protected cancelAddPasskey(): void {
    this.showAddPasskey.set(false);
    this.newPasskeyName.set('');
  }

  protected async deletePasskey(id: string): Promise<void> {
    this.passkeyLoading.set(true);
    try {
      const { error } = await this.auth.passkey.delete(id);
      if (error) {
        this.toast.show({ color: 'error', description: this.errorText(error?.message, 'Passkey konnte nicht gelöscht werden'), title: 'Fehler' });
        return;
      }
      this.toast.show({ color: 'success', description: 'Passkey wurde gelöscht', title: 'Erfolg' });
      await this.loadPasskeys();
    } catch {
      this.toast.show({ color: 'error', description: 'Der Passkey konnte gerade nicht gelöscht werden. Bitte versuche es später erneut.', title: 'Fehler' });
    } finally {
      this.passkeyLoading.set(false);
    }
  }

  protected setPasskeyName(event: Event): void {
    this.newPasskeyName.set((event.target as HTMLInputElement).value);
  }

  /**
   * The text of a refused call: a message with an error code (nest-server's `#LTNS_xxxx`, a project's own `#PROJ_xxxx`)
   * translated, otherwise the German fallback. Better Auth's own 2FA answers ("Invalid code", "Invalid password") carry
   * no code; `translateError` would hand them back unchanged, in English (auth rule 1, `shared/error-text.ts`).
   */
  private errorText(message: string | undefined, fallback: string): string {
    return errorText(message, (text) => this.errors.translateError(text), fallback);
  }
}
