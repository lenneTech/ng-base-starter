/**
 * Keeps a password-reset link across a reload of the page it arrived on, and nowhere else.
 *
 * The reset-password page strips the token from the URL, so a reload would otherwise find none and
 * call a valid link dead. Remembering it is the risk: on a shared device the next person in the
 * tab must not receive it, or they can set the previous person's password.
 *
 * So the link is bound to the history entry that received it: a random id in `history.state`, and
 * the same id next to the token in `sessionStorage`. A reload keeps the entry and with it the id.
 * A redirect lands on an entry without that id, which "the document was reloaded" cannot tell
 * apart, because a reload counts for the whole document and not for one page of the app.
 *
 * The id alone is not enough either. "Back" onto a document the app did not render, such as a
 * proxy's error page or a maintenance page, runs no code of ours, and the reload after it still
 * finds the id and the link. So the memory also expires: `pagehide` stamps it, and it only counts
 * for `RELOAD_WINDOW_MS` after that, whatever ran or did not run in between.
 *
 * `sessionStorage` throws when storage is blocked (private modes, site-data settings). Every
 * access below fails safely: a reload then loses the link, as it did before this memory existed.
 */

/** Key of the id in `history.state`. */
export const RESET_LINK_HISTORY_KEY = 'resetLinkId';

const STORAGE_KEY = 'reset-password-link';

/**
 * How long after leaving the page a reload may still bring the link back.
 *
 * It runs from `pagehide` to the mount of the reloaded page, so it has to cover a slow device
 * loading the bundle. Too short brings the dead link back, too long widens the gap for the next
 * person; 30 seconds is far from both.
 */
const RELOAD_WINDOW_MS = 30_000;

interface StoredLink {
  id?: unknown;
  leftAt?: unknown;
  token?: unknown;
}

/**
 * Erases the link on every document arrival that is not a reload, before the app exists.
 *
 * The page erases on mount as well, but that needs the bundle. Until it has arrived, "Back" followed
 * by a reload is a reload of the entry that carries the id, and nothing has erased the link yet: on
 * a slow device a window of seconds. Inline in the document head, this runs before any of that.
 */
export const ERASE_RESET_LINK_SCRIPT = `try{if(performance.getEntriesByType('navigation')[0]?.type!=='reload')sessionStorage.removeItem('${STORAGE_KEY}')}catch(e){}`;

/** `crypto.randomUUID()` would fit, but it exists in secure contexts only, unlike this. */
export function createResetLinkId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Replaces whatever was remembered: a token in the URL is always the newest link. */
export function rememberResetLink(id: string, token: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id, token }));
  } catch {
    // See above: without storage only the reload case is lost.
  }
}

/** Marks the moment the page was left. The link only counts for a reload shortly after it. */
export function stampResetLink(): void {
  try {
    const stored = readStoredLink();
    if (stored) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, leftAt: Date.now() }));
    }
  } catch {
    // See above: an unstamped link does not come back, which is the safe side.
  }
}

/** The token remembered under exactly this id and left just now, otherwise an empty string. */
export function recallResetLink(id: unknown): string {
  if (typeof id !== 'string' || !id) {
    return '';
  }
  try {
    const { id: storedId, leftAt, token } = readStoredLink() ?? {};
    const isFresh = typeof leftAt === 'number' && Date.now() - leftAt < RELOAD_WINDOW_MS;
    return storedId === id && isFresh && typeof token === 'string' ? token : '';
  } catch {
    return '';
  }
}

export function forgetResetLink(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // See above.
  }
}

function readStoredLink(): null | StoredLink {
  return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null') as null | StoredLink;
}
