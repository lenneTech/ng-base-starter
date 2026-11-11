/**
 * What an error toast says: a message with an error code in the reader's language, any other message in the page's
 * own German words (the Nuxt template's `app/utils/error-text.ts`, nuxt-base-starter #38).
 *
 * `translateError` translates only messages that carry a code, `#LTNS_0002: …` from nest-server or a project's own
 * `#PROJ_0001: …`, and returns everything else unchanged. Better Auth's own answers carry no code ("Invalid code",
 * "Invalid password"), so `translateError(error.message)` showed them in English, and a bare `error.message` showed
 * nest-server's codes raw ("Fehler #LTNS_0002: Invalid password"). This helper picks per message.
 */

/** The shape `translateError` recognises; the same expression as in ng-base's `LtErrorTranslationService`. */
const ERROR_CODE = /^#([A-Z_]+_\d+):\s*(.+)$/s;

/**
 * The text an error toast shows.
 *
 * @param message The error's message, as the API or the client returned it; anything else counts as none.
 * @param translateError `LtErrorTranslationService.translateError`, bound (`(text) => errors.translateError(text)`).
 * @param fallback The page's German text for this failure, shown for every message without a code.
 * @returns The translated message, or the fallback.
 */
export function errorText(message: unknown, translateError: (message: string) => string, fallback: string): string {
  return typeof message === 'string' && ERROR_CODE.test(message) ? translateError(message) : fallback;
}
