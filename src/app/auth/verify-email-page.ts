import { afterNextRender, Component, computed, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, validateStandardSchema } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LT_FETCH, LT_RUNTIME_CONFIG, LtApiUrlService, LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import { HlmButton, HlmInput, LtFormField, LtNotice, LtPageCard } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleCheck, lucideCircleX, lucideLoaderCircle, lucideMailCheck } from '@ng-icons/lucide';

import { fieldError } from '../shared/field-error';
import { appUrl } from './app-origin';
import { verifyAddressSchema, type VerifyAddressModel } from './auth-schemas';
import { injectResendCooldown, resendCooldownSeconds } from './resend-cooldown';
import { safeRedirectTarget } from './safe-redirect-target';
import { recallVerifyEmail, verifyEmailState } from './verify-email-memory';

/** Covers "never existed" and "expired" alike: Better Auth answers both the same way. */
const LINK_DEAD_MESSAGE = 'Dieser Link ist nicht (mehr) gültig. Bitte fordere einen neuen an.';
const SEND_FAILED_MESSAGE = 'Die E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.';

/**
 * A compact JWE (five parts), as nest-server 12.6.0+ puts into the link. Better Auth's own token (from a mail sent
 * before the update) is a JWT (three parts) whose payload carries the address and the user id in plain text.
 */
function isSealed(value: string): boolean {
  return value.split('.').length === 5;
}

/**
 * `/auth/verify-email`: confirms the link from the verification mail, or waits for it, and sends a new one.
 *
 * - Token and address leave the URL at once and live in the history entry (`verify-email-memory.ts`); a reload keeps
 *   the outcome. The token is verified WITHOUT `callbackURL` (with one the endpoint answers 302, not JSON).
 * - "Send a new e-mail" goes by the refused link's token when the API takes it (nest-server 12.6.0+,
 *   `features.resendVerificationByToken`), to the address login or sign-up handed over, or to one the visitor types.
 * - The resend cooldown comes from `GET /iam/features`; `?redirect=` survives the detour back to the login.
 */
@Component({
  imports: [FormField, FormRoot, HlmButton, HlmInput, LtFormField, LtNotice, LtPageCard, NgIcon, RouterLink],
  providers: [provideIcons({ lucideCircleCheck, lucideCircleX, lucideLoaderCircle, lucideMailCheck })],
  selector: 'app-verify-email-page',
  templateUrl: './verify-email-page.html',
})
export class VerifyEmailPage {
  private readonly api = inject(LtApiUrlService);
  private readonly auth = inject(LtAuthService);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly fetch = inject(LT_FETCH);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly runtimeConfig = inject(LT_RUNTIME_CONFIG);
  private readonly toast = inject(LtToastService);

  /** Read once: removing them from the URL must not empty the page, and SSR and the first render agree. */
  protected readonly email = signal(this.route.snapshot.queryParamMap.get('email') ?? '');
  private readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');
  private readonly redirect = this.route.snapshot.queryParamMap.get('redirect');

  protected readonly cooldown = injectResendCooldown();
  protected readonly verifying = signal(false);
  protected readonly verified = signal(false);
  protected readonly verifyError = signal('');
  protected readonly resending = signal(false);
  /** Whether the API takes a refused link's token for a new mail. */
  private readonly resendByToken = signal(false);
  /** The token of the link the server refused; it confirms nothing, but asks for a new mail. */
  private readonly deadToken = signal('');
  /** The address the new mail went to, as the server masked it (`k***@example.com`). */
  protected readonly maskedEmail = signal('');
  /**
   * Locally the API usually has no SMTP: it sends no mail and logs the link (`[EMAIL VERIFICATION]`), so the waiting
   * page says where to look. Only on `NG_PUBLIC_APP_ENV=local`, which `.env.example` sets; any other value or none at
   * all leaves the page as on a deployed stage (fails closed).
   */
  protected readonly localStage = this.runtimeConfig.appEnv === 'local';

  /** Back to the login, with the deep link of the sign-in this page interrupts. */
  protected readonly loginQuery = this.redirect !== null ? { redirect: safeRedirectTarget(this.redirect) } : {};

  protected readonly resendMode = computed<'address' | 'token' | 'typed'>(() => {
    if (this.deadToken() && this.resendByToken()) {
      return 'token';
    }
    return this.email() ? 'address' : 'typed';
  });

  protected readonly resendLabel = computed(() => {
    const label = this.verifyError() ? 'Neue E-Mail senden' : 'Bestätigungs-E-Mail erneut senden';
    return this.cooldown.remaining() > 0 ? `${label} (${this.cooldown.remaining()}s)` : label;
  });

  private readonly addressModel = signal<VerifyAddressModel>({ email: '' });
  protected readonly addressForm = form(this.addressModel, (path) => validateStandardSchema(path, verifyAddressSchema), {
    name: 'verifyEmail',
    submission: { action: async (field) => this.resendToTypedAddress(field().value().email) },
  });
  protected readonly fieldError = fieldError;

  constructor() {
    afterNextRender(() => void this.start());
  }

  private async start(): Promise<void> {
    const remembered = recallVerifyEmail(window.history.state);
    if (!this.email()) {
      this.email.set(remembered.email);
    }
    // First, before any request: the URL should not keep the secrets while the page waits.
    await this.keepSecretsOutOfTheUrl();

    const features = await this.auth.fetchFeatures().catch(() => ({}) as Record<string, unknown>);
    this.resendByToken.set(features['resendVerificationByToken'] === true);

    if (this.token()) {
      await this.verifyToken(this.token());
    } else if (remembered.verified) {
      this.verified.set(true);
    } else if (remembered.deadToken) {
      // A reload after a refused link: offer the new mail again without asking about the token a second time.
      this.deadToken.set(remembered.deadToken);
      this.verifyError.set(LINK_DEAD_MESSAGE);
    } else if (this.route.snapshot.queryParamMap.get('fromRegister') === 'true') {
      this.cooldown.start(resendCooldownSeconds(features));
    }
  }

  private async verifyToken(token: string): Promise<void> {
    this.verifying.set(true);
    this.verifyError.set('');
    try {
      const { data, error } = await this.auth.verifyEmail({ token });
      if (error || !(data as { status?: boolean } | null | undefined)?.status) {
        this.verifyError.set(error?.message ? this.errors.translateError(error.message) : LINK_DEAD_MESSAGE);
        // A refused link (401) can still ask for a new mail; a 5xx says nothing about the link.
        const linkRefused = !(typeof error?.status === 'number' && error.status >= 500);
        if (linkRefused && this.resendByToken()) {
          this.deadToken.set(token);
          this.rememberPage();
        }
        return;
      }
      this.verified.set(true);
      this.rememberPage();
      this.toast.show({ color: 'success', description: 'Deine E-Mail-Adresse wurde erfolgreich verifiziert.', title: 'E-Mail bestätigt' });
    } catch {
      // The transport failed; the link is very likely fine.
      this.verifyError.set('Die Verbindung zum Server ist fehlgeschlagen. Bitte versuche es später erneut.');
    } finally {
      this.verifying.set(false);
    }
  }

  protected async resend(): Promise<void> {
    if (this.resending() || this.cooldown.remaining() > 0) {
      return;
    }
    if (this.resendMode() === 'token') {
      await this.resendWithToken();
    } else if (this.email()) {
      await this.resendToAddress(this.email());
    }
  }

  /** The typed address stays in the form: not in the URL, not in the history entry. */
  private async resendToTypedAddress(address: string): Promise<undefined> {
    if (!this.resending() && this.cooldown.remaining() === 0) {
      await this.resendToAddress(address);
    }
    return undefined;
  }

  /**
   * Asks the API to mail the address the refused token belongs to. The answer is the same whether a mail went out or
   * not (an account that is verified already gets none), so the message promises nothing.
   */
  private async resendWithToken(): Promise<void> {
    this.resending.set(true);
    try {
      const response = await this.fetch(this.api.buildUrl('/iam/resend-verification-email'), {
        body: JSON.stringify({ token: this.deadToken() }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const answer = (await response.json().catch(() => null)) as { email?: null | string; message?: unknown } | null;
      if (!response.ok) {
        // A refusal carries its message (429 LTNS_0020: too many requests for this link); a transport failure does not.
        this.toast.show({ color: 'error', description: typeof answer?.message === 'string' ? this.errors.translateError(answer.message) : SEND_FAILED_MESSAGE, title: 'Fehler' });
        return;
      }
      if (!answer?.email) {
        // The API cannot read this token at all, so there is no address to mail. Ask for it.
        this.deadToken.set('');
        this.rememberPage();
        this.toast.show({
          color: 'error',
          description: 'Zu diesem Link können wir keine neue E-Mail senden. Gib deine E-Mail-Adresse ein, dann schicken wir dir einen neuen Link.',
          title: 'Link nicht erkannt',
        });
        return;
      }
      this.maskedEmail.set(answer.email);
      this.toast.show({
        color: 'success',
        description: `Falls dein Konto noch nicht bestätigt ist, ist eine neue Bestätigungs-E-Mail an ${answer.email} unterwegs.`,
        title: 'E-Mail gesendet',
      });
      this.cooldown.start(resendCooldownSeconds(this.auth.features()));
    } catch {
      this.toast.show({ color: 'error', description: SEND_FAILED_MESSAGE, title: 'Fehler' });
    } finally {
      this.resending.set(false);
    }
  }

  private async resendToAddress(address: string): Promise<boolean> {
    this.resending.set(true);
    try {
      // Absolute: Better Auth resolves a relative callbackURL against its OWN origin (a link to a 404 on the API).
      const { error } = await this.auth.sendVerificationEmail({ callbackURL: appUrl('/auth/verify-email', this.runtimeConfig.siteUrl), email: address });
      if (error) {
        this.toast.show({ color: 'error', description: error.message ? this.errors.translateError(error.message) : SEND_FAILED_MESSAGE, title: 'Fehler' });
        return false;
      }
      this.toast.show({ color: 'success', description: 'Eine neue Bestätigungs-E-Mail wurde gesendet.', title: 'E-Mail gesendet' });
      this.cooldown.start(resendCooldownSeconds(this.auth.features()));
      return true;
    } catch {
      this.toast.show({ color: 'error', description: SEND_FAILED_MESSAGE, title: 'Fehler' });
      return false;
    } finally {
      this.resending.set(false);
    }
  }

  /** Moves token and address out of the URL into this history entry, through the router (it keeps its own copy). */
  private async keepSecretsOutOfTheUrl(): Promise<void> {
    const query = this.route.snapshot.queryParamMap;
    if (!query.has('email') && !query.has('token')) {
      return;
    }
    await this.router.navigate([], { queryParams: { email: null, token: null }, queryParamsHandling: 'merge', replaceUrl: true, state: verifyEmailState(this.email()) });
  }

  /** Notes what a reload needs: the address, an accepted link's outcome, and a refused link's token (sealed ones only). */
  private rememberPage(): void {
    const keptToken = isSealed(this.deadToken()) ? this.deadToken() : '';
    window.history.replaceState({ ...(window.history.state as object), ...verifyEmailState(this.email(), { deadToken: keptToken, verified: this.verified() }) }, '');
  }
}
