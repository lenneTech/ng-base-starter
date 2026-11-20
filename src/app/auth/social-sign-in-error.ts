/**
 * `?error=` on the way back from a social provider: the text the login page shows for it, and the URL cleaning around
 * it. Counterpart of the error half of the Nuxt template's `app/utils/social-sign-in.ts`. The removal of
 * `error_description` before rendering is `sign-in-error-text-guard.ts`, which must not import this file (see there).
 */

/** The code `/auth/callback` sends to the login page when the provider's callback left no session, or the app could not store the auth state. */
export const SOCIAL_SIGN_IN_NO_SESSION = 'session_missing';

/** What the login page shows for an `?error=` it was reached with. */
export interface SocialSignInError {
  description: string;
  title: string;
}

/**
 * The silent attempt would have needed a page at the provider: nothing to say, the form simply appears.
 *
 * With `prompt=none` the provider answers instead of showing its sign-in (`login_required`), any other prompt
 * (`interaction_required`), its consent screen (`consent_required`: a user with a provider session who has not
 * consented to the app yet, for example every user of a tenant without admin consent) or its account picker
 * (`account_selection_required`); OpenID Connect Core 1.0, 3.1.2.6. One click on the provider button
 * (`prompt=select_account`) shows that page and signs the user in. An interactive sign-in never answers these codes, so
 * none of them is a refusal.
 */
const SILENT_MISS = new Set(['account_selection_required', 'consent_required', 'interaction_required', 'login_required']);

/** The provider or Better Auth refused this account. */
const REFUSED: SocialSignInError = {
  description: 'Dieses Konto ist für diese Anwendung nicht freigeschaltet. Bitte wende dich an deine Administration oder melde dich mit einem anderen Konto an.',
  title: 'Kein Zugang',
};

/**
 * Better Auth found an account with the provider's e-mail address that signs in another way (a local account with a
 * password, for example) and links the two only for trusted providers.
 */
const NOT_LINKED: SocialSignInError = {
  description: 'Für diese E-Mail-Adresse gibt es bereits ein Konto mit einer anderen Anmeldeart. Bitte melde dich wie bisher an oder wende dich an die Administration.',
  title: 'Anmeldung nicht möglich',
};

/**
 * The API's callback could not read the state of the sign-in: it took longer than the state lives (ten minutes), or
 * the callback was opened twice. nest-server sends these to the login page WITHOUT `redirect`, because the state that
 * carried it is gone; the page falls back to `/app`.
 */
const INTERRUPTED: SocialSignInError = {
  description: 'Die Anmeldung hat zu lange gedauert oder wurde unterbrochen. Bitte starte sie erneut.',
  title: 'Anmeldung abgebrochen',
};

/** Codes with a message of their own; everything else gets the generic message. */
const MESSAGES: Readonly<Record<string, SocialSignInError>> = {
  access_denied: REFUSED,
  account_not_linked: NOT_LINKED,
  please_restart_the_process: INTERRUPTED,
  signup_disabled: REFUSED,
  state_mismatch: INTERRUPTED,
  state_not_found: INTERRUPTED,
  unauthorized_client: REFUSED,
};

/**
 * The shape of a code, so the generic message can name it for support. Anything else in `error` was not written by
 * the provider or Better Auth, and is not shown.
 */
const CODE_SHAPE = /^[A-Za-z0-9_]{1,64}$/;

/**
 * The message for the `error` query value the login page was reached with, or null for none.
 *
 * Only the code is read, and only a fixed text is returned. Never render `error_description` or any other query value:
 * anybody can write a link to the login page with a text of their choice, and the page would show it in its own voice.
 */
export function socialSignInError(code: unknown): null | SocialSignInError {
  if (code === undefined || code === null || code === '') {
    return null;
  }
  const value = typeof code === 'string' ? code.trim() : '';
  const known = value.toLowerCase();
  if (SILENT_MISS.has(known)) {
    return null;
  }
  if (Object.hasOwn(MESSAGES, known)) {
    return MESSAGES[known] ?? null;
  }
  return {
    description: CODE_SHAPE.test(value)
      ? `Die Anmeldung wurde nicht abgeschlossen (Fehlercode: ${value}). Bitte versuche es erneut.`
      : 'Die Anmeldung wurde nicht abgeschlossen. Bitte versuche es erneut.',
    title: 'Anmeldung fehlgeschlagen',
  };
}

/** True when the query carries what the provider or Better Auth appended on the way back. */
export function hasSignInError(query: Readonly<Record<string, unknown>>): boolean {
  return 'error' in query || 'error_description' in query;
}

/**
 * The query without `error` and `error_description`, everything else kept (`redirect` above all).
 *
 * The login page reads the code once and then replaces the URL with this, so a reload does not bring back a stale
 * message and the code does not stay in the history.
 */
export function withoutSignInError<T>(query: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(query).filter(([name]) => name !== 'error' && name !== 'error_description'));
}
