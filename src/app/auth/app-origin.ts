import { hasControlCharacter } from './safe-redirect-target';

/** Hosts for which plain `http:` is legitimate: classic local dev and `lt dev up`. */
const LOOPBACK_HOST_RE = /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]|.+\.localhost)$/i;

/** Single leading slash, and the next character must not start a second one. */
const ABSOLUTE_PATH_RE = /^\/(?![/\\])/;

/**
 * The absolute origin to build auth redirect URLs from.
 *
 * Why this exists: Better Auth validates `redirectTo` / `callbackURL` against its
 * trusted origins and answers 403 INVALID_REDIRECT_URL for anything it cannot match.
 * A template string over a missing config value does not fail loudly — it produces
 * the literal text `"undefined"`, which is what reached production:
 *
 *     {"email":"…","redirectTo":"undefined/auth/reset-password"}   → 403
 *
 * A relative path is not an alternative: Better Auth resolves it with
 * `new URL(callbackURL, ctx.baseURL)` against the **API** origin, so it would point
 * at `api.<host>` rather than the app.
 *
 * `configured` wins when it parses as a usable absolute URL — a deployment behind a
 * public hostname that differs from the origin the browser sees (a proxy, a vanity
 * domain) needs to be able to say so. Everything else falls back to the origin the
 * request actually came from, which is by definition an origin the app is served under.
 *
 * Only the *origin* is kept. A configured value carrying a path, query, or embedded
 * credentials would otherwise be baked into every URL built from it, and the
 * downstream check compares origins — so it would never notice the junk.
 *
 * Returns `''` on the server, where there is no window to fall back to. Callers that
 * need a URL should use {@link appUrl}, which turns that into a thrown error rather
 * than a silently relative link.
 *
 * The server check is `typeof window`: the same function runs during SSR and in unit
 * tests, where no browser globals exist.
 *
 * `configured` is typed `unknown` because it crosses a CONFIG boundary (the runtime
 * config the server writes into the page), unlike `path`, which is a literal from app
 * code and therefore stays `string`. Keep it `unknown`: a value from outside the
 * program has to prove its type at runtime.
 *
 * @param configured Usually `inject(RUNTIME_CONFIG).siteUrl`, fed by `NG_PUBLIC_SITE_URL` (see `.env.example`).
 */
export function resolveAppOrigin(configured?: unknown): string {
  const candidate = typeof configured === 'string' ? configured.trim() : '';

  // `undefined`/`null` as TEXT is the exact failure this function exists for: it
  // arrives as a real string once a template literal has swallowed the value.
  if (candidate && candidate !== 'undefined' && candidate !== 'null' && !hasControlCharacter(candidate)) {
    try {
      const url = new URL(candidate);
      const isLoopback = LOOPBACK_HOST_RE.test(url.hostname);
      if (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback)) {
        return url.origin;
      }
    } catch {
      // Not parseable as an absolute URL — fall through to the browser origin.
    }
  }

  if (typeof window === 'undefined') {
    return '';
  }

  // The fallback branch IS the misconfigured case, so it is worth a trace. Without
  // one the failure surfaces in a user's inbox — a link to the wrong host — where
  // nothing is watching. This runs once per submit, never in a render path.
  console.warn(
    `[app-origin] NG_PUBLIC_SITE_URL is unset or unusable (got: ${JSON.stringify(configured)}). ` +
      `Falling back to ${window.location.origin}. Set it in every non-local deployment — ` +
      `behind a proxy or vanity domain the browser origin is not the public one.`,
  );

  return window.location.origin;
}

/**
 * An absolute app URL for `path`.
 *
 * Throws rather than returning a half-built URL: with no window and nothing
 * configured, concatenating onto an empty origin yields a *relative* value that
 * Better Auth accepts and then resolves against the API base URL — a link to the
 * wrong host. That is the same silently-wrong class as the `"undefined/…"` bug this
 * module exists to prevent, so it fails at the call instead.
 *
 * `path` must be a single-slash absolute path, under the same contract as
 * {@link safeRedirectTarget} — no protocol-relative `//`, no backslash variant, no
 * control characters. Every current caller passes a literal, but the signature
 * invites a variable.
 *
 * @param path Absolute path with a single leading slash, e.g. `/auth/reset-password`.
 * @param configured Usually `inject(RUNTIME_CONFIG).siteUrl`.
 * @throws If `path` is not a valid absolute path, or if no origin can be resolved
 *   (server-side with nothing configured).
 * @example
 * ```ts
 * const { siteUrl } = inject(RUNTIME_CONFIG);
 * await auth.requestPasswordReset({
 *   email,
 *   redirectTo: appUrl('/auth/reset-password', siteUrl),
 * });
 * ```
 */
export function appUrl(path: string, configured?: unknown): string {
  if (typeof path !== 'string' || !ABSOLUTE_PATH_RE.test(path) || hasControlCharacter(path)) {
    throw new Error(`appUrl() expects a single-slash absolute path, got: ${JSON.stringify(path)}`);
  }

  const origin = resolveAppOrigin(configured);
  if (!origin) {
    throw new Error('appUrl() needs a configured siteUrl when called outside the browser — ' + 'set NG_PUBLIC_SITE_URL, or call it from a client-side handler.');
  }

  return `${origin}${path}`;
}
