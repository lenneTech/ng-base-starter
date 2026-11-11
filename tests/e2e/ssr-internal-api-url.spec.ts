/**
 * The server-rendered HTML never contains the API address only the SSR server can reach (`NG_API_URL`).
 *
 * A project rendered image sources during SSR with the server's URL builder, so production HTML pointed browsers at
 * the internal `http://api:3000/...` (found in a project, 2026-11-11). In ng-base
 * a URL that goes into the HTML is built with `buildBrowserUrl()` / `LtFileService.getFileUrl()`; `buildUrl()` is for
 * requests. Angular's HTTP transfer cache is the other way in: it writes each response an SSR request received into the
 * HTML together with its URL (`u`), so a successful `HttpClient` call to `NG_API_URL` during SSR would leak it too.
 *
 * The spec starts its own instance of the built server (`${NG_OUTPUT_DIR:-.output}/server/index.mjs`) twice, with an
 * internal and a public API URL that differ, and requests every server-rendered page signed out, signed in and as admin
 * (through the client-writable `lt-auth-state` cookie, a UI gate only):
 * - against an unreachable internal host, which finds an address written into a link or the runtime config;
 * - against a second spelling of the real API (`localhost` ↔ `127.0.0.1`), so the SSR requests succeed and a transfer
 *   cache entry or a cached response body would show it. Skipped when the API does not answer or has no second spelling.
 * Without a build the spec skips, unless `E2E_BUILT_SERVER=true` promised one (CI), where it fails.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { API_BASE } from './helpers/auth-backend';

const ROOT = join(import.meta.dirname, '..', '..');
const ENTRY = join(ROOT, process.env['NG_OUTPUT_DIR'] || '.output', 'server', 'index.mjs');
const PUBLIC_API_URL = 'https://api.example.com';

/** Server-rendered pages (src/app/app.routes.server.ts: everything but the AI pages and /app/admin/system), the 404 included. */
const PAGES = [
  '/',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password?token=ssr-check',
  '/auth/verify-email',
  '/auth/2fa',
  '/auth/setup',
  '/app',
  '/app/settings/security',
  '/app/admin',
  '/gibt-es-nicht',
  '/robots.txt',
  '/sitemap.xml',
];

/** The client-writable auth-state cookie for a user with the given roles: SSR renders /app (and, for an admin, /app/admin). */
function authStateCookie(roles: string[]): string {
  return `lt-auth-state=${encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: { email: 'ssr@test.com', id: 'ssr', name: 'SSR', roles } }))}`;
}

/** Signed out, signed in, and as admin. */
const VISITORS = [
  { cookie: '', label: 'signed out' },
  { cookie: authStateCookie([]), label: 'signed in' },
  { cookie: authStateCookie(['admin']), label: 'admin' },
];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

/** Starts the built server with the given internal API URL; resolves once it listens. */
async function startServer(internalApiUrl: string): Promise<{ base: string; server: ChildProcess }> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      NG_API_URL: internalApiUrl,
      NG_PUBLIC_API_PROXY: 'false',
      NG_PUBLIC_API_URL: PUBLIC_API_URL,
      NG_PUBLIC_SITE_URL: base,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the built server did not start within 30 s')), 30_000);
    server.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the built server exited with ${code}`));
    });
  });
  return { base, server };
}

/** The server-rendered HTML of every page for every visitor. */
async function renderAll(base: string): Promise<Array<{ html: string; page: string }>> {
  const results: Array<{ html: string; page: string }> = [];
  for (const page of PAGES) {
    for (const { cookie, label } of VISITORS) {
      const response = await fetch(`${base}${page}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
      results.push({ html: await response.text(), page: `${page} (${label})` });
    }
  }
  return results;
}

/** `localhost` ↔ `127.0.0.1`: the same API under a spelling the HTML can be searched for. */
function secondSpelling(url: string): null | string {
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost') {
    parsed.hostname = '127.0.0.1';
  } else if (parsed.hostname === '127.0.0.1') {
    parsed.hostname = 'localhost';
  } else {
    return null;
  }
  return parsed.origin;
}

test.describe('SSR never writes the internal API address into the HTML', () => {
  test.beforeAll(() => {
    if (!existsSync(ENTRY)) {
      expect(process.env['E2E_BUILT_SERVER'], `E2E_BUILT_SERVER=true but no build at ${ENTRY}`).not.toBe('true');
    }
  });

  test('with an unreachable internal API: no page carries its address', async () => {
    test.skip(!existsSync(ENTRY), `No built server at ${ENTRY} (pnpm run build)`);
    const internal = 'http://api-internal.invalid:3000';
    const { base, server } = await startServer(internal);
    try {
      const rendered = await renderAll(base);
      for (const { html, page } of rendered) {
        expect(html, `${page} contains the internal API address`).not.toContain('api-internal.invalid');
      }
      // The browser gets the public address instead (runtime config of the landing page).
      expect(rendered[0]?.html).toContain(PUBLIC_API_URL);
    } finally {
      server.kill('SIGTERM');
    }
  });

  test('with the real API under its internal spelling: no successful SSR request leaks it', async ({ request }) => {
    test.skip(!existsSync(ENTRY), `No built server at ${ENTRY} (pnpm run build)`);
    const internal = secondSpelling(API_BASE);
    test.skip(!internal, `${API_BASE} has no second spelling to tell internal from public`);
    let apiUp = false;
    try {
      apiUp = (await request.get(`${internal}/meta`)).ok();
    } catch {
      apiUp = false;
    }
    test.skip(!apiUp, `The API does not answer at ${internal}`);

    const { base, server } = await startServer(internal as string);
    try {
      const host = new URL(internal as string).host;
      for (const { html, page } of await renderAll(base)) {
        expect(html, `${page} contains the internal API address ${host}`).not.toContain(host);
      }
    } finally {
      server.kill('SIGTERM');
    }
  });
});
