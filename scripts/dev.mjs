#!/usr/bin/env node
/**
 * `pnpm run dev` / `pnpm start`: `ng serve` on the port the backend contract needs.
 *
 * - `PORT` (default 3001) and `HOST` (default: the Angular CLI's `localhost`). `lt dev`
 *   passes both. The API's local defaults trust exactly `http://localhost:3001`; another
 *   port fails 2FA and passkeys with `403 INVALID_ORIGIN` (plan §8).
 * - A busy port is REFUSED with a clear message. The Angular CLI would otherwise offer to
 *   pick another port, and the app would then run on an origin the API does not trust.
 * - `.env` is loaded when present (the Nuxt dev server does the same); variables already
 *   set in the shell win. The built server never reads `.env`.
 */
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The dev port: `PORT` when it is a valid port number, otherwise 3001. */
export function resolveDevPort(env = process.env) {
  const port = Number.parseInt((env.PORT || '').trim(), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 3001;
}

/** Resolves true when `port` can be bound on `host`; an address family the machine lacks counts as free. */
export function isPortFree(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error) => resolve(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT'));
    server.listen({ exclusive: true, host, port }, () => server.close(() => resolve(true)));
  });
}

/** The hosts to probe: the configured one, or both loopback families for the CLI default `localhost`. */
export function probeHosts(host) {
  return host ? [host] : ['127.0.0.1', '::1'];
}

/** The `ng serve` arguments for a port and an optional host. */
export function serveArgs(port, host) {
  return ['serve', `--port=${port}`, ...(host ? [`--host=${host}`] : []), ...process.argv.slice(2)];
}

async function main() {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  const port = resolveDevPort();
  const host = (process.env.HOST || '').trim() || undefined;
  for (const probe of probeHosts(host)) {
    if (!(await isPortFree(port, probe))) {
      console.error(
        [
          `dev: port ${port} is already in use (${probe}).`,
          '',
          'The app must run on the port the API trusts (3001 by default): another port fails 2FA and',
          'passkeys with 403 INVALID_ORIGIN. Stop the process holding the port, or set PORT together',
          "with the API's APP_URL/BASE_URL (what `lt dev up` does).",
        ].join('\n'),
      );
      process.exit(1);
    }
  }
  const require = createRequire(import.meta.url);
  const ngBin = require.resolve('@angular/cli/bin/ng.js', { paths: [ROOT] });
  const child = spawn(process.execPath, [ngBin, ...serveArgs(port, host)], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

function isCliEntry() {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  await main();
}
