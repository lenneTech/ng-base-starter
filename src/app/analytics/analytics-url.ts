/**
 * What analytics may learn about a page, and nothing more.
 *
 * Nothing that names a person or opens an account leaves the page, whichever server receives it:
 * no token or code, no e-mail address, no record id, no click id, no free text. Before 2.35.0 a reset
 * link handed its live token to the analytics host on its first request, and `verify-email` added
 * the address. What does leave, and only that:
 *
 * - the path, every segment that could identify somebody replaced by {@link MASK},
 * - the campaign labels in {@link CAMPAIGN_PARAMS}, only with a value that is a plain label,
 * - `gclid` and `msclkid` as `1`, so a paid click still counts while its id stays on the page.
 *
 * Every other query parameter and the fragment are dropped. The rules are allowlists, so a new page
 * or parameter needs no change here to stay private. The one thing a rule cannot see is a short code
 * behind a fixed word (`/s/aB3dE`): a project adds that word to {@link PROJECT_TOKEN_SEGMENTS}.
 *
 * A path that resolves to one of the app's own static routes keeps every segment (see
 * {@link staticRoutes}): it holds nothing but the code's own words, so `/invite/accept` stays itself
 * next to `/invite/:code`. The masks are for dynamic routes and for paths no route knows.
 *
 * Custom events (`track()` from `@plausible-analytics/tracker`, `window.plausible`) report `location.href` unless they get a `url`,
 * so they pass `analyticsUrl(window.location.href)`, and their props carry no personal data: no
 * e-mail, no name, no id.
 */

/** What every masked path segment becomes. */
const MASK = ':id';

/** A segment after one of these is a secret, whatever it looks like. Lower case. */
const TOKEN_SEGMENTS = ['invite', 'koppeln', 'password-reset', 'passwort-setzen', 'reset', 's', 'share', 'token', 'verify'];

/**
 * The project's own words in front of a token or code, lower case, the same way as {@link TOKEN_SEGMENTS}.
 *
 * Empty in the template, which has no such route. A route `einladung/:code` needs `'einladung'`,
 * and every entry needs a test in `src/app/analytics/analytics-url.spec.ts` that fails without it.
 */
const PROJECT_TOKEN_SEGMENTS: readonly string[] = [];

/** The campaign labels analytics may see. `utm_term` and `utm_content` are not among them: they often hold free text or a recipient id. */
const CAMPAIGN_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source'];

/** Paid-click ids: analytics learns that one was there, never its value. */
const CLICK_ID_PARAMS = ['gclid', 'msclkid'];

/** A campaign value that is a plain label. Anything longer or with other characters is dropped. */
const LABEL = /^[\w.~-]{1,64}$/;

const OBJECT_ID = /^[\da-f]{24}$/i;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const LONG_NUMBER = /^\d{5,}$/;
const E_MAIL = /@|%40/i;

/** From this length on, a segment has to read as words to be kept: random tokens and codes are this long. */
const TOKEN_LENGTH = 16;

/**
 * A slug: lower-case words and short numbers, joined by hyphens (`rueckblick-2026`).
 *
 * Lower case on purpose. A random token over this alphabet is mixed case or carries digits; one that
 * matches a case-insensitive word pattern is rare, but rare is not never.
 */
const WORDS = /^(?:[a-z]+|\d{1,4})(?:-(?:[a-z]+|\d{1,4}))*$/;

/** Whether a path segment or a part of a campaign value could identify a person or a record. */
function looksLikeIdentifier(value: string): boolean {
  return OBJECT_ID.test(value) || UUID.test(value) || LONG_NUMBER.test(value) || E_MAIL.test(value) || (value.length >= TOKEN_LENGTH && !WORDS.test(value));
}

function isTokenSegment(segment: string): boolean {
  let word = segment;
  try {
    word = decodeURIComponent(segment);
  } catch {
    // A malformed escape is no word of ours either.
  }
  word = word.toLowerCase();
  return TOKEN_SEGMENTS.includes(word) || PROJECT_TOKEN_SEGMENTS.includes(word);
}

/** The path with every segment that could identify somebody replaced by {@link MASK}. */
function analyticsPath(pathname: string): string {
  const segments = pathname.split('/');
  return segments
    .map((segment, index) => {
      if (!segment) {
        return segment;
      }
      const afterTokenSegment = index > 0 && isTokenSegment(segments[index - 1] ?? '');
      return afterTokenSegment || looksLikeIdentifier(segment) ? MASK : segment;
    })
    .join('/');
}

/** Whether a campaign value is a plain label and none of its parts an identifier. */
function isLabel(value: string): boolean {
  return LABEL.test(value) && !value.split(/[.~]/).some(looksLikeIdentifier);
}

/** Whether a path is one of the app's own static routes. */
export type IsStaticRoute = (pathname: string) => boolean;

/**
 * {@link IsStaticRoute} from the app's router: true for a path that resolves to routes without a
 * parameter, false for a dynamic route, a path no route matches, and anything the router rejects.
 * `src/app/analytics/route-resolver.ts` provides `resolve` for the Angular route config.
 */
export function staticRoutes(router: { resolve: (to: string) => { matched: ReadonlyArray<{ path: string }> } }): IsStaticRoute {
  return (pathname) => {
    try {
      const { matched } = router.resolve(pathname);
      return matched.length > 0 && matched.every((record) => !record.path.includes(':'));
    } catch {
      return false;
    }
  };
}

/**
 * The page URL as analytics may see it: origin, masked path, and the parameters listed in the header.
 *
 * With `isStaticRoute`, a path of a static route keeps its segments; its query is reduced all the same.
 */
export function analyticsUrl(href: string, isStaticRoute?: IsStaticRoute): string {
  const url = new URL(href);
  const reported = new URLSearchParams();
  for (const name of CAMPAIGN_PARAMS) {
    const value = url.searchParams.get(name);
    if (value !== null && isLabel(value)) {
      reported.set(name, value);
    }
  }
  for (const name of CLICK_ID_PARAMS) {
    if (url.searchParams.has(name)) {
      reported.set(name, '1');
    }
  }
  const query = reported.toString();
  const path = isStaticRoute?.(url.pathname) ? url.pathname : analyticsPath(url.pathname);
  return `${url.origin}${path}${query ? `?${query}` : ''}`;
}

/**
 * A referrer as analytics may see it: its origin, or nothing.
 *
 * The tracker sends `document.referrer` with every event, and no event option reaches it.
 * `Referrer-Policy: strict-origin` cuts it down for links inside the app, but a visitor arriving from
 * another site brings whatever that site's policy lets through, full URL included.
 */
export function analyticsReferrer(referrer: null | string | undefined): null | string {
  if (!referrer) {
    return null;
  }
  try {
    const { origin } = new URL(referrer);
    // `file:`, `data:` and the like have an opaque origin, serialised as the string "null".
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Sends pageviews with {@link analyticsUrl}, the way the tracker's own capture does otherwise.
 *
 * That capture has to stay off (`plausible.autoPageviews`). It reports `location.href` the moment
 * the tracker starts, before any page can strip a token, and the `engagement` event repeats the
 * pageview's URL when the page is left.
 *
 * This covers the pageview URL. `src/app/analytics/plausible.ts` starts the tracker and masks every
 * event in its `transformRequest`: custom events, the `url` the tracker adds to a click on a tagged
 * link, and the referrer.
 */
export function reportPageviews(
  report: (options: { url: string }) => void,
  router: { afterEach: (hook: () => void) => unknown; resolve?: (to: string) => { matched: ReadonlyArray<{ path: string }> } },
): void {
  const isStaticRoute = router.resolve ? staticRoutes({ resolve: router.resolve.bind(router) }) : undefined;
  const reportCurrentPage = (): void => report({ url: analyticsUrl(window.location.href, isStaticRoute) });
  let reportedPath = window.location.pathname;

  reportCurrentPage();

  router.afterEach(() => {
    // Only a new path counts: stripping a token replaces the URL on the same page.
    if (window.location.pathname !== reportedPath) {
      reportedPath = window.location.pathname;
      reportCurrentPage();
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      reportCurrentPage();
    }
  });
}
