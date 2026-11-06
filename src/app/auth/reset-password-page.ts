import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, DOCUMENT, type ElementRef, inject, Injector, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { form, FormField, FormRoot, required, validateStandardSchema } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LtErrorTranslationService } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import { HlmButton, LtFormField, LtNotice, LtPageCard, LtPageCardFooter, LtPasswordInput } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleCheck, lucideShieldCheck } from '@ng-icons/lucide';

import { fieldError } from '../shared/field-error';
import { resetPasswordSchema, type ResetPasswordModel } from './auth-schemas';
import { createResetLinkId, ERASE_RESET_LINK_SCRIPT, forgetResetLink, recallResetLink, RESET_LINK_HISTORY_KEY, rememberResetLink, stampResetLink } from './reset-link-memory';

/**
 * Better Auth answers `POST /reset-password` with five failures under ONE status (400), so only the `code` separates
 * "the link is dead" from "the input is wrong" from "try later" (rule A.9.2). "Request a new link" after a 429 or 500
 * would send the user straight back into the path that just failed.
 */
const LINK_ERROR_CODES = new Set(['INVALID_TOKEN', 'TOKEN_EXPIRED', 'USER_NOT_FOUND']);
const PASSWORD_ERROR_CODES = new Set(['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG']);

/** Unknown and expired on purpose: Better Auth answers both with `INVALID_TOKEN`. Same wording as nest-server's LTNS_0027. */
const LINK_DEAD_MESSAGE = 'Dieser Link ist nicht (mehr) gültig. Bitte fordere einen neuen an.';

/**
 * `/auth/reset-password?token=`: set a new password with the link from the mail (the path is fixed by
 * nest-server-starter's `passwordResetLink`).
 *
 * The token leaves the address bar the moment it is read and is bound to this history entry (`reset-link-memory.ts`):
 * a reload of that entry may bring it back for 30 s, nothing else does. On a shared device the next person in the tab
 * must never inherit it. Dead links and system errors stay on the page as alerts; input errors appear at the field.
 */
@Component({
  host: {
    '(window:pagehide)': 'stampLink()',
    '(window:pageshow)': 'onPageShow($event)',
  },
  imports: [FormField, FormRoot, HlmButton, LtFormField, LtNotice, LtPageCard, LtPageCardFooter, LtPasswordInput, NgIcon, RouterLink],
  providers: [provideIcons({ lucideCircleCheck, lucideShieldCheck })],
  selector: 'app-reset-password-page',
  templateUrl: './reset-password-page.html',
})
export class ResetPasswordPage {
  private readonly auth = inject(LtAuthService);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly successHeading = viewChild<ElementRef<HTMLElement>>('successHeading');

  /** Read once: removing it from the URL must not take the form with it, and SSR and the first render agree. */
  private readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');
  protected readonly isTokenValid = computed(() => this.token().length > 0);
  protected readonly loading = signal(false);
  protected readonly resetSuccess = signal(false);
  /** Link or system problem, shown as a persistent alert: a toast would vanish while the reader still looks at the form. */
  protected readonly submitError = signal('');
  protected readonly submitErrorKind = signal<'link' | 'system'>('system');
  /** Input problem, shown at the field. */
  protected readonly passwordError = signal('');

  private readonly model = signal<ResetPasswordModel>({ confirmPassword: '', password: '' });
  protected readonly passwordForm = form(
    this.model,
    (path) => {
      required(path.password, { message: 'Passwort ist erforderlich' });
      required(path.confirmPassword, { message: 'Passwortbestätigung ist erforderlich' });
      validateStandardSchema(path, resetPasswordSchema);
    },
    { name: 'resetPassword', submission: { action: async (field) => this.reset(field().value().password) } },
  );
  protected readonly fieldError = fieldError;

  constructor() {
    // Server only: the head script erases a remembered link on every arrival that is not a reload, before any app code
    // runs (also when the bundle never arrives). In the browser it would run again after the arrival stored the link.
    if (isPlatformServer(inject(PLATFORM_ID))) {
      const document = inject(DOCUMENT);
      const script = document.createElement('script');
      script.textContent = ERASE_RESET_LINK_SCRIPT;
      document.head.appendChild(script);
    }

    afterNextRender(() => {
      if (this.isTokenValid()) {
        this.keepLinkOutOfTheUrl();
        return;
      }
      this.token.set(this.recallLinkOnReload());
      // Any other way here is not the person who opened the mail continuing; they must not inherit the link.
      if (!this.isTokenValid()) {
        this.dropLink();
      }
    });

    // Leaving the page inside the app ends the flow. A reload is a full document load and never runs this.
    inject(DestroyRef).onDestroy(() => {
      if (this.isBrowser) {
        forgetResetLink();
      }
    });
  }

  /** Starts the short window in which a reload may bring the link back. */
  protected stampLink(): void {
    stampResetLink();
  }

  /** A return from the back/forward cache restores the page whole, token included; it may be the next person. */
  protected onPageShow(event: PageTransitionEvent): void {
    if (event.persisted) {
      this.dropLink();
    }
  }

  private async reset(newPassword: string): Promise<undefined> {
    this.loading.set(true);
    this.submitError.set('');
    this.passwordError.set('');
    try {
      const result = await this.auth.resetPassword({ newPassword, token: this.token() });
      if (result.error) {
        this.applyError(result.error);
        return undefined;
      }
      // Used up: a reload must not offer a form that can only fail.
      forgetResetLink();
      this.resetSuccess.set(true);
      afterNextRender(() => this.successHeading()?.nativeElement.focus(), { injector: this.injector });
    } catch {
      // The transport failed (offline, DNS, a proxy). The link is very likely fine, so never "request a new link".
      this.submitError.set('Die Verbindung zum Server ist fehlgeschlagen. Bitte versuche es später erneut.');
      this.submitErrorKind.set('system');
    } finally {
      this.loading.set(false);
    }
    return undefined;
  }

  /** Routes one Better Auth failure to the place where its correction happens. */
  private applyError(error: { code?: string; message?: string }): void {
    const code = error.code ?? '';
    const translated = error.message ? this.errors.translateError(error.message) : '';
    if (PASSWORD_ERROR_CODES.has(code)) {
      this.passwordError.set(translated || 'Das Passwort erfüllt die Anforderungen nicht.');
      return;
    }
    if (LINK_ERROR_CODES.has(code)) {
      this.submitErrorKind.set('link');
      forgetResetLink();
      // `USER_NOT_FOUND` deliberately carries no translation from nest-server (no enumeration oracle).
      this.submitError.set(code === 'USER_NOT_FOUND' ? LINK_DEAD_MESSAGE : translated || LINK_DEAD_MESSAGE);
      return;
    }
    this.submitErrorKind.set('system');
    this.submitError.set(translated || 'Das Zurücksetzen ist gerade nicht möglich. Bitte versuche es später erneut.');
  }

  /**
   * Drops the token from the address bar and binds it to this history entry. Through the router, never
   * `history.replaceState` behind its back: the router would write its own copy of the location back.
   */
  private keepLinkOutOfTheUrl(): void {
    const id = createResetLinkId();
    rememberResetLink(id, this.token());
    void this.router.navigate([], { queryParams: {}, replaceUrl: true, state: { [RESET_LINK_HISTORY_KEY]: id } });
  }

  /** The remembered link, when this arrival is a reload of the history entry that received it. */
  private recallLinkOnReload(): string {
    const [navigation] = window.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    const state = window.history.state as Record<string, unknown> | null;
    return navigation?.type === 'reload' ? recallResetLink(state?.[RESET_LINK_HISTORY_KEY]) : '';
  }

  /** Ends the link on this page: nothing left to submit, nothing left to recall. */
  private dropLink(): void {
    this.token.set('');
    forgetResetLink();
    this.submitError.set('Der Link zum Zurücksetzen des Passworts ist ungültig oder fehlt.');
    this.submitErrorKind.set('link');
  }
}
