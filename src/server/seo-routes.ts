/**
 * `robots.txt`, `sitemap.xml` and the per-route `X-Robots-Tag`, the parts of the Nuxt
 * template's `@nuxtjs/seo` setup a crawler sees before any JavaScript runs.
 *
 * - `/` is the only indexable page. `/app`, `/auth` and `/admin` are disallowed in
 *   robots.txt AND carry `X-Robots-Tag: noindex, nofollow`: robots.txt only asks, the
 *   header travels with the page itself, so a leaked URL (a shared reset link, a
 *   referrer) stays out of an index even when the crawler never read robots.txt.
 * - Outside production (`NG_PUBLIC_APP_ENV` other than `production`) the whole site is
 *   non-indexable, so a develop or test stage never competes with the live site.
 */

/** Path prefixes that never belong in a search index. */
export const NOINDEX_PREFIXES: readonly string[] = Object.freeze(['/app', '/auth', '/admin']);

/** Value of the `X-Robots-Tag` for non-indexable responses. */
export const NOINDEX_VALUE = 'noindex, nofollow';

/** Whether the stage may be indexed at all. An unset stage label means production (the image default). */
export function isIndexableEnv(appEnv: string | undefined): boolean {
  const env = appEnv?.trim().toLowerCase();
  return !env || env === 'production';
}

/** Whether `path` (no query) falls under one of the `NOINDEX_PREFIXES`. */
export function isNoindexPath(path: string): boolean {
  return NOINDEX_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** The `X-Robots-Tag` to send for `path`, or null when the page may be indexed. */
export function robotsTagFor(path: string, appEnv: string | undefined): null | string {
  return !isIndexableEnv(appEnv) || isNoindexPath(path) ? NOINDEX_VALUE : null;
}

/** Origin of the site URL without a trailing slash; empty when it is unset or invalid. */
function siteOrigin(siteUrl: string | undefined): string {
  try {
    return new URL(siteUrl ?? '').origin;
  } catch {
    return '';
  }
}

/** The robots.txt body. */
export function buildRobotsTxt(options: { appEnv: string | undefined; siteUrl: string | undefined }): string {
  const lines = ['User-agent: *'];
  if (isIndexableEnv(options.appEnv)) {
    lines.push(...NOINDEX_PREFIXES.map((prefix) => `Disallow: ${prefix}`));
    const origin = siteOrigin(options.siteUrl);
    if (origin) {
      lines.push('', `Sitemap: ${origin}/sitemap.xml`);
    }
  } else {
    lines.push('Disallow: /');
  }
  return `${lines.join('\n')}\n`;
}

/** Public, indexable routes listed in the sitemap. Add a project's own public pages here. */
export const SITEMAP_PATHS: readonly string[] = Object.freeze(['/']);

/** The sitemap.xml body; empty `<urlset>` when no valid site URL is configured. */
export function buildSitemapXml(options: { paths?: readonly string[]; siteUrl: string | undefined }): string {
  const origin = siteOrigin(options.siteUrl);
  const urls = origin ? (options.paths ?? SITEMAP_PATHS).filter((path) => !isNoindexPath(path)).map((path) => `  <url><loc>${origin}${path}</loc></url>`) : [];
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}
