/**
 * Validates a `?redirect=` query value into a safe same-origin navigation target.
 *
 * `auth.global` sends an unauthenticated visitor to
 * `/auth/login?redirect=<the page they wanted>` (as `to.fullPath`). Three places read
 * that value back: `guest.global` for someone already signed in, and the `login` and
 * `2fa` pages after a successful sign-in. All three MUST agree on what is valid —
 * when they did not, one of them accepted shapes the others rejected.
 *
 * What this accepts: a single-slash absolute path (`/app/records/42?tab=x#y`).
 * What it rejects, and why:
 *
 * - `//evil.com` — protocol-relative; the browser resolves it to another origin.
 * - `/\evil.com` — the same attack via backslash, which browsers normalise to `/`.
 * - a tab, newline or carriage return anywhere in the value — the WHATWG URL parser
 *   strips those from input BEFORE resolving, so `/<TAB>/evil.com` becomes
 *   `//evil.com`, i.e. the first case wearing a disguise. A lookahead that inspects
 *   only the character after the leading slash cannot see this, which is why the
 *   control-character test is separate rather than folded into a cleverer regex.
 *   The whole C0 range plus DEL is rejected: none of it belongs in a route, and an
 *   allowlist of "the three that are known to be strippable" would have to be
 *   revisited every time a URL parser changes its mind.
 * - a non-string (`?redirect=/a&redirect=/b` yields an array, a bare `?redirect`
 *   yields `null`).
 *
 * What it deliberately does NOT reject: percent-encoded slashes (`/%2f%2fevil.com`).
 * The Angular router resolves those as a literal path segment, so the target stays
 * same-origin — it is a 404, not a redirect. Pinned by a test so the decision stays
 * deliberate rather than accidental.
 *
 * Validating at the read site matters: in the Nuxt template, relying on the router to
 * refuse an external target surfaced as "Ein unerwarteter Fehler ist aufgetreten" to a
 * user who was by then signed in. Here a bad target becomes a silent, correct fallback.
 */

/**
 * True when the value contains a C0 control character (U+0000–U+001F) or DEL
 * (U+007F).
 *
 * Deliberately a code-point scan rather than a regex character class: the literal
 * characters are invisible in an editor, so a class written with them cannot be
 * reviewed or safely edited, and the escaped form trips `no-control-regex`. Comparing
 * code points states the intent in plain arithmetic and needs no lint exemption.
 *
 * Exported because `app-origin.ts` builds paths under the same contract. The two
 * redirect utilities in this directory MUST agree on what a path may contain —
 * when they did not, the weaker one is the one a reader copies.
 */
export function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function safeRedirectTarget(target: unknown, fallback = '/app'): string {
  if (typeof target !== 'string') {
    return fallback;
  }
  // Single leading slash, and the next character must not start a second one.
  if (!/^\/(?![/\\])/.test(target)) {
    return fallback;
  }
  if (hasControlCharacter(target)) {
    return fallback;
  }
  return target;
}
