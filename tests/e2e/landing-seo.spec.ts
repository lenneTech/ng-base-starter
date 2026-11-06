import { expect, test } from '@playwright/test';

import { FRONTEND_BASE } from './helpers/auth-backend';

/**
 * The landing page is the only indexable route (`/app`, `/auth` and `/admin` are noindex), so its
 * head is what search engines and link previews show for the whole project.
 *
 * Two defaults every generated project inherits went wrong here:
 *
 * - The title doubled: `app.head.title` equals `site.name`, and nuxt-seo-utils' title template
 *   appends the site name to every title, so a page without its own title rendered
 *   "Nuxt Base Starter | Nuxt Base Starter". app.vue's titleTemplate catches that; this test keeps
 *   it caught.
 * - There was no meta description. og:description is inferred from it, so it rendered empty as
 *   well, and unhead warned on every page view in dev ("Page is missing a meta description and is
 *   indexable", "og:description has empty content").
 *
 * Asserted on the SERVER html: crawlers and link-preview bots do not run JavaScript, so a tag that
 * only appears after hydration does not exist for them.
 */
test.describe('Landing page head', () => {
  let html: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${FRONTEND_BASE}/`, { headers: { 'Accept-Language': 'de' } });
    expect(res.ok()).toBe(true);
    html = await res.text();
  });

  /** The content of the first `<meta>` whose `attr` equals `value`, or undefined. */
  function meta(attr: 'name' | 'property', value: string): string | undefined {
    const tag = [...html.matchAll(/<meta\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`${attr}="${value}"`));
    return tag ? /\bcontent="([^"]*)"/.exec(tag)?.[1] : undefined;
  }

  test('renders exactly one title, without the site name repeated', () => {
    const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
    expect(titles).toHaveLength(1);
    const title = titles[0] ?? '';
    expect(title.trim()).not.toBe('');
    // "X | X" for any separator — the shape nuxt-seo-utils produces when the page title IS the site name.
    expect(title, 'title repeats the site name').not.toMatch(/^(.+?)\s+\S+\s+\1$/);
  });

  test('renders a meta description, and og:description follows it', () => {
    const description = meta('name', 'description');
    expect(description?.trim(), 'meta description').toBeTruthy();
    expect(meta('property', 'og:description'), 'og:description').toBe(description);
  });
});
