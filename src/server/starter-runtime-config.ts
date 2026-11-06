/**
 * The starter's own public runtime values next to ng-base's (`ltAngularRequestHandler`'s `extend` in `src/server.ts`),
 * read per request like every `NG_*` value and written into `<script id="ng-runtime-config">`. The app reads them as
 * `inject(LT_RUNTIME_CONFIG)['<key>']`. Only public values belong here: the browser sees all of them.
 *
 * - `plausibleApiHost` (`NG_PUBLIC_PLAUSIBLE_API_HOST`): the analytics host; empty means no tracker at all, never a
 *   fallback to plausible.io (`src/app/analytics/plausible.ts`).
 */
export function starterRuntimeConfig(env: Readonly<Record<string, string | undefined>>): { plausibleApiHost: string } {
  return { plausibleApiHost: env['NG_PUBLIC_PLAUSIBLE_API_HOST']?.trim() ?? '' };
}
