import { simpleDiscord, simpleGithub, simpleX } from '@ng-icons/simple-icons';

/**
 * The brand icons of header and footer, without the `<title>` Simple Icons puts into every SVG. The icons are
 * decorative (`aria-hidden`, the link carries the `aria-label`), and a `<title>` in the body made the server HTML of
 * the landing page carry a second "title", the one thing `tests/e2e/landing-seo.spec.ts` rules out.
 */
function withoutTitle(svg: string): string {
  return svg.replace(/<title>[^<]*<\/title>/g, '');
}

export const BRAND_ICONS = {
  simpleDiscord: withoutTitle(simpleDiscord),
  simpleGithub: withoutTitle(simpleGithub),
  simpleX: withoutTitle(simpleX),
};
