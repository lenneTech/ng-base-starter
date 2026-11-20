import { DOCUMENT, inject } from '@angular/core';

/**
 * Remembers what the silent sign-in through a social provider must not repeat (`social-providers.ts`). Counterpart of
 * `socialSignInMarks` in the Nuxt template's `app/utils/social-sign-in.ts`, with the same keys.
 *
 * - **Attempted**, per tab, in `sessionStorage`. Set before the attempt starts. Without a provider session the provider
 *   sends the browser back to the login page, which would otherwise start the next attempt: a loop. A new tab may try
 *   once of its own.
 * - **Signed out**, for every tab of this browser, in `localStorage`. Set on an explicit sign-out. The provider session
 *   outlives the app's, so a silent attempt after it would sign the visitor straight back in, and not only in the tab
 *   that signed out: measured in the Nuxt template while this mark was per tab, a new tab of the same browser sent
 *   `prompt=none` within four seconds of "Abmelden" and was in the app again. `localStorage` is shared by every tab of
 *   the origin and survives closing them.
 *
 * Every completed sign-in clears both, in both stores (password and passkey on the login page, the second factor on
 * `/auth/2fa`, a provider on `/auth/callback` once the auth state is stored where a reload reads it), so a later visit
 * without a session, after the session expired, may try again.
 *
 * Both stores are per origin, so two apps on different origins cannot share the marks. The keys are fixed, with a
 * prefix of their own. Fail closed: when either store is missing (server rendering), blocked or throws, no silent
 * attempt runs.
 */
export interface SocialSignInMarks {
  /**
   * Clears both marks from both stores, a "signed out" mark the first Nuxt version left in `sessionStorage` included.
   * Each removal on its own, so one blocked store does not keep the other's.
   */
  clear(): void;
  /** Sets the "signed out" mark for every tab. False when `localStorage` refused the write. */
  markSignedOut(): boolean;
  /** Sets the "attempted" mark. False when storage refused the write; the attempt must not start then. */
  markSilentAttempt(): boolean;
  /** True while both stores work and no mark is set. A missing, blocked or throwing store: false. */
  maySignInSilently(): boolean;
}

/** The `sessionStorage` key of the "attempted" mark. */
export const SILENT_ATTEMPTED_KEY = 'lt-social-sign-in:silent-attempted';

/**
 * The `localStorage` key of the "signed out" mark. The first Nuxt version kept it under the same key in
 * `sessionStorage`; there it still counts for its tab, and `clear()` removes it.
 */
export const SIGNED_OUT_KEY = 'lt-social-sign-in:signed-out';

/** The part of a window the marks read: its two stores. */
export type SocialSignInMarksView = Partial<Pick<Window, 'localStorage' | 'sessionStorage'>>;

type StoreName = 'localStorage' | 'sessionStorage';

/** The store, or null where there is none or its accessor throws (blocked: private modes, site settings). */
function storeOf(view: null | SocialSignInMarksView | undefined, name: StoreName): null | Storage {
  try {
    return view?.[name] ?? null;
  } catch {
    return null;
  }
}

/** The marks on the stores of `view` (a window, or null on the server). Every method fails safely. */
export function socialSignInMarksOf(view: null | SocialSignInMarksView | undefined): SocialSignInMarks {
  return {
    clear() {
      for (const name of ['sessionStorage', 'localStorage'] as const) {
        for (const key of [SILENT_ATTEMPTED_KEY, SIGNED_OUT_KEY]) {
          try {
            storeOf(view, name)?.removeItem(key);
          } catch {
            // Blocked storage holds no marks.
          }
        }
      }
    },
    markSignedOut() {
      try {
        const shared = storeOf(view, 'localStorage');
        shared?.setItem(SIGNED_OUT_KEY, '1');
        return shared?.getItem(SIGNED_OUT_KEY) === '1';
      } catch {
        return false;
      }
    },
    markSilentAttempt() {
      try {
        const tab = storeOf(view, 'sessionStorage');
        tab?.setItem(SILENT_ATTEMPTED_KEY, '1');
        return tab?.getItem(SILENT_ATTEMPTED_KEY) === '1';
      } catch {
        return false;
      }
    },
    maySignInSilently() {
      try {
        const tab = storeOf(view, 'sessionStorage');
        const shared = storeOf(view, 'localStorage');
        return !!tab && !!shared && tab.getItem(SILENT_ATTEMPTED_KEY) === null && tab.getItem(SIGNED_OUT_KEY) === null && shared.getItem(SIGNED_OUT_KEY) === null;
      } catch {
        return false;
      }
    },
  };
}

/**
 * The marks of this document's window, in an injection context. On the server there is no browser storage, so every
 * method fails closed there; the pages call them in the browser only (after render, on a click).
 */
export function injectSocialSignInMarks(): SocialSignInMarks {
  const document = inject(DOCUMENT);
  return socialSignInMarksOf(document.defaultView);
}
