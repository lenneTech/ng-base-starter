import { expect, test } from '@playwright/test';

import { FRONTEND_BASE } from './helpers/auth-backend';

/**
 * Behind a reverse proxy (Traefik on a deployed stage, Caddy under `lt dev`) every request carries `X-Forwarded-*`.
 * SSR believes the forwarded host and scheme (`src/server/proxy-headers.ts`, `NG_TRUST_PROXY_HEADERS`) and drops the
 * other forwarded headers before Angular sees them, which would otherwise log two lines per header and request.
 *
 * A believed forwarded host passes the same check as the `Host` header (Angular's SSRF guard, `allowedHosts`): one that
 * is not on the list is answered with 400, never rendered.
 */
test.describe('SSR behind a reverse proxy', () => {
  // Caddy replaces every forwarded header a client sends with its own, so a forged one never reaches the app there.
  test.skip(!!process.env['LT_DEV_ACTIVE'], 'under lt dev, Caddy sets the forwarded headers itself');

  const host = new URL(FRONTEND_BASE).host;

  test('renders a request with the headers Traefik adds', async ({ request }) => {
    const res = await request.get(`${FRONTEND_BASE}/`, {
      headers: {
        'x-forwarded-for': '203.0.113.7',
        'x-forwarded-host': host,
        'x-forwarded-port': '443',
        'x-forwarded-proto': 'https',
        'x-forwarded-server': 'traefik-6d5f',
        'x-real-ip': '203.0.113.7',
      },
    });

    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('<app-root');
  });

  test('answers 400 to a forwarded host that is not allowed, instead of rendering for it', async ({ request }) => {
    const res = await request.get(`${FRONTEND_BASE}/`, { headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' } });

    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('evil.example');
  });
});
