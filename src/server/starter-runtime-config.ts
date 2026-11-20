/**
 * The starter's own public runtime values next to ng-base's (`ltAngularRequestHandler`'s `extend` in `src/server.ts`),
 * read per request like every `NG_*` value and written into `<script id="ng-runtime-config">`. The app reads them as
 * `inject(LT_RUNTIME_CONFIG)['<key>']`. Only public values belong here: the browser sees all of them.
 *
 * - `authSilentProvider` (`NG_PUBLIC_AUTH_SILENT_PROVIDER`): the social provider (an id from `/iam/features` →
 *   `socialProviders`, e.g. `microsoft`) for the silent sign-in on the login page; empty means off
 *   (`src/app/auth/social-providers.ts`).
 * - `plausibleApiHost` (`NG_PUBLIC_PLAUSIBLE_API_HOST`): the analytics host; empty means no tracker at all, never a
 *   fallback to plausible.io (`src/app/analytics/plausible.ts`).
 */
export function starterRuntimeConfig(env: Readonly<Record<string, string | undefined>>): { authSilentProvider: string; plausibleApiHost: string } {
  return {
    authSilentProvider: env['NG_PUBLIC_AUTH_SILENT_PROVIDER']?.trim() ?? '',
    plausibleApiHost: env['NG_PUBLIC_PLAUSIBLE_API_HOST']?.trim() ?? '',
  };
}
