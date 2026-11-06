/**
 * Contract tests for the small server decisions `src/server.ts` applies: allowed hosts (Angular's SSRF
 * guard), robots.txt/sitemap.xml/X-Robots-Tag, the HTML no-cache headers and the build identity.
 */
import { describe, expect, it } from 'vitest';

import { resolveAllowedHosts } from '../../../src/server/allowed-hosts';
import { resolveListenAddress } from '../../../src/server/listen-address';
import { buildRobotsTxt, buildSitemapXml, isNoindexPath, NOINDEX_VALUE, robotsTagFor } from '../../../src/server/seo-routes';
import { starterRuntimeConfig } from '../../../src/server/starter-runtime-config';

describe('starterRuntimeConfig (the starter values next to ng-base runtime config)', () => {
  it('passes the Plausible host on, trimmed', () => {
    expect(starterRuntimeConfig({ NG_PUBLIC_PLAUSIBLE_API_HOST: '  https://plausible.example.com ' })).toEqual({
      plausibleApiHost: 'https://plausible.example.com',
    });
  });

  it('has no host without the variable or with blanks only, so no tracker starts and nothing falls back to plausible.io', () => {
    expect(starterRuntimeConfig({})).toEqual({ plausibleApiHost: '' });
    expect(starterRuntimeConfig({ NG_PUBLIC_PLAUSIBLE_API_HOST: '   ' })).toEqual({ plausibleApiHost: '' });
  });

  it('ignores the Nuxt variable name, which an Angular image never reads', () => {
    expect(starterRuntimeConfig({ NUXT_PLAUSIBLE_API_URL: 'https://plausible.example.com' })).toEqual({ plausibleApiHost: '' });
  });
});

describe('resolveListenAddress (where the built server listens)', () => {
  it('defaults to 3001, the app port of the backend contract, so a local run never collides with the API on 3000', () => {
    expect(resolveListenAddress({})).toEqual({ host: undefined, port: 3001 });
  });

  it('takes PORT and HOST from the environment (the image sets PORT=3000, HOST=0.0.0.0)', () => {
    expect(resolveListenAddress({ HOST: ' 0.0.0.0 ', PORT: '3000' })).toEqual({ host: '0.0.0.0', port: 3000 });
  });

  it('ignores an unusable PORT and a blank HOST', () => {
    expect(resolveListenAddress({ HOST: '  ', PORT: 'abc' })).toEqual({ host: undefined, port: 3001 });
  });
});

describe('resolveAllowedHosts', () => {
  it('adds the host of the site URL, so a deployed stage is not answered with 400', () => {
    expect(resolveAllowedHosts({ NG_PUBLIC_SITE_URL: 'https://shop.example.com/' })).toEqual(['shop.example.com']);
  });

  it('merges NG_ALLOWED_HOSTS, which Angular would ignore once the engine gets its own list', () => {
    expect(resolveAllowedHosts({ NG_ALLOWED_HOSTS: ' www.example.com, *.preview.example.com ,', NG_PUBLIC_SITE_URL: 'https://example.com' })).toEqual([
      'www.example.com',
      '*.preview.example.com',
      'example.com',
    ]);
  });

  it('adds nothing for an unset or invalid site URL, and never a wildcard of its own', () => {
    expect(resolveAllowedHosts({})).toEqual([]);
    expect(resolveAllowedHosts({ NG_PUBLIC_SITE_URL: 'not a url' })).toEqual([]);
  });
});

describe('robots and sitemap', () => {
  it('keeps /app, /auth and /admin out of the index, on the path and below it', () => {
    for (const path of ['/app', '/app/settings/security', '/auth/login', '/admin']) {
      expect(isNoindexPath(path), path).toBe(true);
      expect(robotsTagFor(path, 'production'), path).toBe(NOINDEX_VALUE);
    }
  });

  it('does not match a prefix inside another word', () => {
    expect(isNoindexPath('/application')).toBe(false);
    expect(isNoindexPath('/authors')).toBe(false);
  });

  it('lets the landing page be indexed in production only (an unset stage label is production)', () => {
    expect(robotsTagFor('/', 'production')).toBeNull();
    expect(robotsTagFor('/', undefined)).toBeNull();
    for (const env of ['local', 'development', 'test', 'ci']) {
      expect(robotsTagFor('/', env), env).toBe(NOINDEX_VALUE);
    }
  });

  it('disallows the private areas in production and names the sitemap', () => {
    expect(buildRobotsTxt({ appEnv: 'production', siteUrl: 'https://example.com/path' })).toBe(
      'User-agent: *\nDisallow: /app\nDisallow: /auth\nDisallow: /admin\n\nSitemap: https://example.com/sitemap.xml\n',
    );
  });

  it('disallows everything on every other stage', () => {
    expect(buildRobotsTxt({ appEnv: 'test', siteUrl: 'https://test.example.com' })).toBe('User-agent: *\nDisallow: /\n');
  });

  it('lists only indexable paths, absolute to the site URL', () => {
    const xml = buildSitemapXml({ paths: ['/', '/app', '/pricing'], siteUrl: 'https://example.com' });
    expect(xml).toContain('<loc>https://example.com/</loc>');
    expect(xml).toContain('<loc>https://example.com/pricing</loc>');
    expect(xml).not.toContain('/app');
  });

  it('renders an empty urlset without a site URL instead of relative or guessed URLs', () => {
    expect(buildSitemapXml({ siteUrl: '' })).not.toContain('<url>');
  });
});
