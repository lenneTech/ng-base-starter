import { afterNextRender, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { LtAuthStateService, LtAuthStore } from '@lenne.tech/ng-base/auth/provide';

import { safeRedirectTarget } from './safe-redirect-target';
import { SOCIAL_SIGN_IN_NO_SESSION } from './social-sign-in-error';
import { injectSocialSignInMarks } from './social-sign-in-marks';

/**
 * `/auth/callback`: the last step of a sign-in through a social provider (the Nuxt template's `pages/auth/callback.vue`).
 *
 * The API's OAuth callback sends the browser here (`callbackURL` of the login page) after the provider signed the user
 * in. The session is in the API's httpOnly cookie by then; `validateSession()` loads the user into the auth state. No
 * `ltAuthGuard` on this route: the user is not loaded yet.
 *
 * A session is not yet a completed sign-in. Every reload reads the user from the `lt-auth-state` cookie. When the
 * browser refused to store it (over its 4096 bytes, for example), the auth store still holds the user in memory and the
 * next page would show the app, but the next reload lands on `/auth/login?redirect=…` without `error`, and the login
 * page of every new tab starts the next silent attempt: app, API and provider loop, a session row per round. So the
 * page goes on only when `LtAuthStateService.readState()`, the read of the cookie itself, finds the user, and otherwise
 * clears the user from memory before it returns to the login page with `error=session_missing`. ng-base keeps an
 * inline profile photo out of the cookie, the cause the Nuxt template measured; this check covers every other one.
 *
 * Imports `/auth/provide` only: no Better Auth code in this page's bundle.
 */
@Component({
  selector: 'app-callback-page',
  templateUrl: './callback-page.html',
})
export class CallbackPage {
  /** `?redirect=` of the URL (router input binding); validated before use, the query is anybody's to write. */
  readonly redirect = input<unknown>();

  private readonly authState = inject(LtAuthStateService);
  private readonly marks = injectSocialSignInMarks();
  private readonly router = inject(Router);
  private readonly store = inject(LtAuthStore);

  constructor() {
    afterNextRender(() => void this.finish());
  }

  private async finish(): Promise<void> {
    const target = safeRedirectTarget(this.redirect());

    let signedIn = false;
    try {
      signedIn = await this.store.validateSession();
    } catch {
      signedIn = false;
    }

    // Complete only when the auth state is where a reload looks for it (see above).
    if (signedIn && this.authState.readState()?.user) {
      // A sign-in through the provider worked, so the next visit without a session may try the silent attempt again.
      this.marks.clear();
      await this.router.navigateByUrl(target, { replaceUrl: true });
      return;
    }

    // The provider was done, but no session arrived (a session cookie the browser refused, an expired state), or the
    // app could not store the auth state. The marks stay, and the login page, reached with `error`, never starts a
    // silent attempt: it shows the code instead of looping. The deep link survives the detour.
    //
    // `validateSession()` has put the user into the store's memory even when the cookie was refused, and `guestGuard`
    // reads that memory: it would turn the way to the login page into the deep link, with a sign-in that is gone at the
    // next reload and no word about it. So the memory goes first (the Nuxt template's guest middleware reads the cookie
    // and never sees it).
    this.store.clearUser();
    await this.router.navigate(['/auth/login'], { queryParams: { error: SOCIAL_SIGN_IN_NO_SESSION, redirect: target }, replaceUrl: true });
  }
}
