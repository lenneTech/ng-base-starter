/**
 * Host names the SSR engine accepts (Angular's SSRF guard, `security.allowedHosts`).
 *
 * Angular 22 answers `400 Bad Request` to every request whose `Host` (or a trusted
 * `X-Forwarded-Host`) is not on the list. `angular.json` carries the local names
 * (`localhost`, `127.0.0.1`, `*.localhost` for `lt dev`); a deployed stage needs its own
 * public host as well. Hard-coding it would mean one build per domain, so it is added at
 * runtime:
 *
 * - the host of `NG_PUBLIC_SITE_URL`, which every deployed stage sets anyway, and
 * - every entry of `NG_ALLOWED_HOSTS` (comma separated, `*.example.com` allowed), for
 *   extra domains. Angular reads that variable itself, but only when the engine gets no
 *   `allowedHosts` option, so it is merged here explicitly.
 *
 * `*` is never added here: it switches the guard off and must stay a deliberate choice
 * made in `NG_ALLOWED_HOSTS`.
 */
export function resolveAllowedHosts(env: NodeJS.ProcessEnv): string[] {
  const hosts = new Set<string>();
  for (const entry of (env['NG_ALLOWED_HOSTS'] ?? '').split(',')) {
    const host = entry.trim().toLowerCase();
    if (host) {
      hosts.add(host);
    }
  }
  const siteUrl = env['NG_PUBLIC_SITE_URL']?.trim();
  if (siteUrl) {
    try {
      hosts.add(new URL(siteUrl).hostname.toLowerCase());
    } catch {
      // An invalid site URL is reported by the app's config check; it adds no host here.
    }
  }
  return [...hosts];
}
