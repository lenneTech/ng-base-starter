import { lucideApple, lucideGrid2x2, lucideLogIn } from '@ng-icons/lucide';

import { BRAND_ICONS } from '../shared/brand-icons';

/**
 * Sign-in through a social provider the API configures (`betterAuth.socialProviders` in nest-server, listed by
 * `GET /iam/features` as `socialProviders`). First use: Microsoft Entra ID as single sign-on.
 *
 * `login-page.ts` shows one button per provider and, when the project opted in (`NG_PUBLIC_AUTH_SILENT_PROVIDER`),
 * tries once per tab to take over the visitor's provider session without showing anything (`prompt=none`);
 * `callback-page.ts` finishes the sign-in. This file holds what a button shows and which provider the silent attempt
 * takes; the marks that keep the attempt from looping are in `social-sign-in-marks.ts`, the texts for `?error=` in
 * `social-sign-in-error.ts`. Counterpart of the Nuxt template's `app/utils/social-sign-in.ts`.
 */

/** What a provider's button shows: an icon name registered by the login page, and the provider's name. */
export interface SocialProviderDisplay {
  icon: string;
  label: string;
}

/** Shown for a provider without an icon of its own. */
export const SOCIAL_PROVIDER_FALLBACK_ICON = 'lucideLogIn';

/**
 * Every icon a provider button can show, for the login page's `provideIcons()`.
 *
 * Lucide in `@ng-icons/lucide` has no brand marks any more (the Nuxt template's `@iconify-json/lucide` still keeps a
 * few deprecated ones), so the buttons take the brand marks the app already ships for header and footer
 * (`BRAND_ICONS`, Simple Icons without their `<title>`), Lucide's apple and four squares (the shape of Microsoft's logo),
 * and the neutral icon for the rest. Another brand mark would add its SVG to the login page's bundle for every visitor.
 */
export const SOCIAL_PROVIDER_ICONS: Readonly<Record<string, string>> = {
  lucideApple,
  lucideGrid2x2,
  lucideLogIn,
  simpleDiscord: BRAND_ICONS.simpleDiscord,
  simpleGithub: BRAND_ICONS.simpleGithub,
  simpleX: BRAND_ICONS.simpleX,
};

/** The providers Better Auth ships, by the id the API configures them under. */
const KNOWN_PROVIDERS: Readonly<Record<string, SocialProviderDisplay>> = {
  apple: { icon: 'lucideApple', label: 'Apple' },
  atlassian: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Atlassian' },
  cognito: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Amazon Cognito' },
  discord: { icon: 'simpleDiscord', label: 'Discord' },
  dropbox: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Dropbox' },
  facebook: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Facebook' },
  figma: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Figma' },
  github: { icon: 'simpleGithub', label: 'GitHub' },
  gitlab: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'GitLab' },
  google: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Google' },
  huggingface: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Hugging Face' },
  linear: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Linear' },
  linkedin: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'LinkedIn' },
  microsoft: { icon: 'lucideGrid2x2', label: 'Microsoft' },
  notion: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Notion' },
  paypal: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'PayPal' },
  reddit: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Reddit' },
  salesforce: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Salesforce' },
  slack: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Slack' },
  spotify: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Spotify' },
  tiktok: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'TikTok' },
  twitch: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Twitch' },
  twitter: { icon: 'simpleX', label: 'X' },
  vercel: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Vercel' },
  zoom: { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Zoom' },
};

/** Label and icon for a provider's button; an unknown id gets its own name, capitalised. */
export function socialProviderDisplay(id: string): SocialProviderDisplay {
  const known = Object.hasOwn(KNOWN_PROVIDERS, id) ? KNOWN_PROVIDERS[id] : undefined;
  if (known) {
    return known;
  }
  return { icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: id.charAt(0).toUpperCase() + id.slice(1) };
}

/** Every icon name `socialProviderDisplay()` can hand out, for the check against `SOCIAL_PROVIDER_ICONS`. */
export function socialProviderIcons(): string[] {
  return [...new Set([SOCIAL_PROVIDER_FALLBACK_ICON, ...Object.values(KNOWN_PROVIDERS).map((provider) => provider.icon)])];
}

/** The provider ids `/iam/features` lists (`auth.features()['socialProviders']`); nothing else. */
export function socialProvidersOf(features: unknown): string[] {
  const listed = (features as null | undefined | { socialProviders?: unknown })?.socialProviders;
  if (!Array.isArray(listed)) {
    return [];
  }
  return [...new Set(listed.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))];
}

/**
 * The provider id the project configured for the silent attempt, or null while the setting is off.
 *
 * `configured` is `inject(LT_RUNTIME_CONFIG)['authSilentProvider']` (`NG_PUBLIC_AUTH_SILENT_PROVIDER`, written by
 * `src/server/starter-runtime-config.ts`), typed `unknown` because it crosses the runtime-config boundary. Empty, the
 * default, means off. Known on the server too, so the login page renders its first paint from it: the checking state
 * instead of the form while the setting is on.
 */
export function configuredSilentProvider(configured: unknown): null | string {
  const id = typeof configured === 'string' ? configured.trim() : '';
  return id || null;
}

/** The provider for the silent attempt: the configured one (`configuredSilentProvider`), and only while the API lists it. */
export function silentSignInProvider(configured: unknown, providers: readonly string[]): null | string {
  const id = configuredSilentProvider(configured);
  return id && providers.includes(id) ? id : null;
}

/**
 * How long the login page waits for `/iam/features` before it gives up the silent attempt and shows the form, in
 * milliseconds.
 *
 * The server renders the login page with the feature flags it fetched itself (`provideLtAuth()` waits for them on the
 * server and transfers them), so the browser usually knows the provider list when the page starts. Without it (the
 * server could not reach the API) the page asks the API from the browser. A failed request shows the form at once;
 * this covers an API that is slow or does not answer, so nobody stays on the checking state. Three seconds, as in the
 * Nuxt template: several times a healthy answer and short enough to wait through. Features that arrive later start no
 * attempt: the visitor may be typing by then.
 */
export const SILENT_SIGN_IN_FEATURES_TIMEOUT_MS = 3000;
