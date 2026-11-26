import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, required, validate, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtSystemSetupService } from '@lenne.tech/ng-base/auth';
import { LtAuthStore } from '@lenne.tech/ng-base/auth/provide';
import { HlmButton, HlmInput, LtFormField, LtNotice, LtPageCard, LtPasswordInput } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideShieldCheck } from '@ng-icons/lucide';

import { fieldError } from '../shared/field-error';
import { setupSchema, type SetupModel } from './auth-schemas';

/**
 * `/auth/setup`: create the first administrator while the API has none (`GET /system-setup/status`).
 *
 * The form only while the API takes the first admin over HTTP: outside `local`, `ci` and `e2e`, nest-server closes
 * `POST /system-setup/init` unless `systemSetup.httpInit` opens it, and every submit would fail with 403. Then the page
 * explains the configuration instead. After a 403 the service re-reads the status, so a submit refused with LTNS_0053
 * lands on that explanation by itself. The setup token (LTNS_0054 when wrong) is asked for only when required.
 *
 * On an API that signs in through providers alone (`/iam/features` reports `emailAndPassword: false`, nest-server
 * 12.11.0+) the form stays, since `POST /system-setup/init` still wants a password, and a hint says how the admin signs
 * in: through a provider whose account carries the same address. Better Auth links that account to the admin on the
 * first sign-in only when the provider reports the address as verified (the setup marks the admin's own address
 * verified). GitHub does; Microsoft Entra ID only with the optional ID token claim `verified_primary_email`. Otherwise
 * the sign-in ends with `account_not_linked`. Never point at `account.accountLinking.trustedProviders` instead: it makes
 * Better Auth link whatever address the provider names, verified or not, and an Entra tenant admin who sets a user's
 * `mail` to the admin's address signs in as the admin ("nOAuth"). The features are fetched during SSR, so the server
 * HTML already carries the hint.
 */
@Component({
  imports: [FormField, FormRoot, HlmButton, HlmInput, LtFormField, LtNotice, LtPageCard, LtPasswordInput, NgIcon, RouterLink],
  providers: [provideIcons({ lucideShieldCheck })],
  selector: 'app-setup-page',
  templateUrl: './setup-page.html',
})
export class SetupPage {
  /** The light store (`/auth/provide`) is enough for the feature flags; this page signs nobody in. */
  private readonly auth = inject(LtAuthStore);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly router = inject(Router);
  private readonly setup = inject(LtSystemSetupService);
  private readonly toast = inject(LtToastService);

  protected readonly loading = signal(false);
  protected readonly tokenRequired = computed(() => this.setup.httpInitTokenRequired() === true);
  /** Sign-in through providers alone: the admin's password only satisfies the setup. */
  protected readonly providersOnly = computed(() => this.auth.features()['emailAndPassword'] === false);
  protected readonly view = computed<'checking' | 'closed' | 'done' | 'form'>(() => {
    const needsSetup = this.setup.needsSetup();
    if (needsSetup === false) {
      return 'done';
    }
    if (needsSetup === true) {
      return this.setup.httpInitEnabled() === false ? 'closed' : 'form';
    }
    return 'checking';
  });

  private readonly model = signal<SetupModel>({ confirmPassword: '', email: '', name: '', password: '', token: '' });
  protected readonly setupForm = form(
    this.model,
    (path) => {
      required(path.name, { message: 'Name ist erforderlich' });
      required(path.email, { message: 'E-Mail ist erforderlich' });
      required(path.password, { message: 'Passwort ist erforderlich' });
      required(path.confirmPassword, { message: 'Passwortbestätigung ist erforderlich' });
      validateStandardSchema(path, setupSchema);
      // Only the API can tell a wrong token (LTNS_0054), so there is no length rule, just presence when required.
      validate(path.token, ({ value }) => (this.tokenRequired() && !value().trim() ? { kind: 'required', message: 'Setup-Token ist erforderlich' } : null));
    },
    { name: 'setup', submission: { action: async (field) => this.initSetup(field().value()) } },
  );
  protected readonly fieldError = fieldError;

  constructor() {
    void this.setup.checkSetupStatus();
    void this.auth.fetchFeatures();
  }

  private async initSetup(input: SetupModel): Promise<undefined> {
    this.loading.set(true);
    try {
      await this.setup.initSetup({ email: input.email, name: input.name, password: input.password, token: this.tokenRequired() ? input.token : undefined });
      this.toast.show({ color: 'success', description: 'Das System wurde erfolgreich eingerichtet.', title: 'Administrator-Account erstellt' });
      await this.router.navigateByUrl('/auth/login');
    } catch (error: unknown) {
      // The error itself, not `error.message`: the #LTNS_ code is in the response body.
      this.toast.show({ color: 'error', description: error ? this.errors.translateError(error) : 'Einrichtung fehlgeschlagen', title: 'Fehler' });
    } finally {
      this.loading.set(false);
    }
    return undefined;
  }
}
