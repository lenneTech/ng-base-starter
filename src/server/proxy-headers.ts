import type { IncomingHttpHeaders } from 'node:http';

/**
 * Which forwarded headers the SSR engine believes (Angular's `trustProxyHeaders`).
 *
 * Every deployed stage runs behind a reverse proxy (Traefik on TurboOps, Caddy under `lt dev`), which adds
 * `X-Forwarded-For`, `-Host`, `-Port`, `-Proto` and `-Server` to each request. Angular believes none of them unless
 * told to, so SSR saw `http://` behind an HTTPS proxy, and dropped every one with a warning of two lines, ten lines per
 * request in the app log and in the terminal of `lt dev`.
 *
 * By default SSR believes the public host and scheme (`x-forwarded-host`, `x-forwarded-proto`). That opens no new way
 * in: Angular checks a believed forwarded host against the same `allowedHosts` as the `Host` header (a host not on the
 * list gets 400), and the scheme can only be `http` or `https`. Both proxies set the two headers themselves and ignore
 * what a client sends. `NG_TRUST_PROXY_HEADERS` (Angular's own variable, comma separated) replaces the default, e.g.
 * `x-forwarded-proto` alone where the `Host` header must stay the only host, or `forwarded` for an RFC 7239 proxy;
 * Angular refuses `*` and any name that is not `forwarded` or `x-forwarded-*` when the server starts.
 */
export function resolveTrustProxyHeaders(env: NodeJS.ProcessEnv): string[] {
  const fromEnv = new Set<string>();
  for (const entry of (env['NG_TRUST_PROXY_HEADERS'] ?? '').split(',')) {
    const header = entry.trim().toLowerCase();
    if (header) {
      fromEnv.add(header);
    }
  }
  return fromEnv.size > 0 ? [...fromEnv] : ['x-forwarded-host', 'x-forwarded-proto'];
}

/**
 * Removes the forwarded headers SSR does not believe from a request before Angular sees it. Angular would drop them
 * as well, but logs each one on every request; the app never reads them either way.
 */
export function dropUntrustedProxyHeaders(headers: IncomingHttpHeaders, trusted: readonly string[]): void {
  for (const name of Object.keys(headers)) {
    const header = name.toLowerCase();
    if ((header === 'forwarded' || header.startsWith('x-forwarded-')) && !trusted.includes(header)) {
      Reflect.deleteProperty(headers, name);
    }
  }
}
