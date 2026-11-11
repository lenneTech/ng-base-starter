/**
 * Guards `scripts/check-server-start.mjs`, the last step of every `check` chain.
 *
 * The pure helpers are checked directly. The runner is checked end to end as the CLI the
 * chain calls, against small fixture servers in `fixtures/server-start/`, and OUT OF
 * PROCESS: the unit setup replaces `fetch` in this test environment, and the exit code of the
 * real process is what the `check` chain acts on. After each run the server's port must
 * be closed again, i.e. the server really was stopped. Signals only ever reach the
 * fixture child the runner itself spawned; the Windows kill path is covered by the plan
 * test only.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isCleanShutdown, isKillablePid, isReadyOutput, isRenderedStatus, killTreePlan, NG_DEFAULTS, parseArgs, PID1_SIGNAL_PRELOAD } from '../../scripts/check-server-start.mjs';

const fixtures = join(import.meta.dirname, 'fixtures', 'server-start');
const runner = join(import.meta.dirname, '..', '..', 'scripts', 'check-server-start.mjs');

/** Run the CLI against a fixture; resolves to its exit code, output, the port it used and how long it ran. */
function runFixture(entry: string, timeoutSeconds = 10, args: string[] = []): Promise<{ code: null | number; ms: number; output: string; port: number }> {
  // The CLI keeps an inherited NG_API_URL on purpose, and the CI test job sets one for the E2E
  // suite; the assertions here are about the default, so the fixture runs without it.
  const { NG_API_URL: _apiUrl, NG_PUBLIC_API_URL: _publicApiUrl, ...env } = process.env;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [runner, `--entry=${entry}`, `--timeout=${timeoutSeconds}`, ...args], { cwd: fixtures, env });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.once('close', (code) => resolve({ code, ms: Date.now() - started, output, port: Number(/Using free port: (\d+)/.exec(output)?.[1]) }));
  });
}

/** Resolves true when something accepts a connection on the port. */
function portAcceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('check-server-start helpers', () => {
  it.each([200, 204, 301, 302, 399])('counts HTTP %i as rendered', (status) => {
    expect(isRenderedStatus(status)).toBe(true);
  });

  it.each([0, 199, 400, 404, 500, Number.NaN])('does not count HTTP %s as rendered', (status) => {
    expect(isRenderedStatus(status)).toBe(false);
  });

  it('recognises the Angular SSR ready line', () => {
    expect(isReadyOutput('Node Express server listening on http://0.0.0.0:3000', NG_DEFAULTS.readyPatterns)).toBe(true);
    expect(isReadyOutput('building…', NG_DEFAULTS.readyPatterns)).toBe(false);
  });

  it('plans taskkill on Windows and a signal elsewhere', () => {
    expect(killTreePlan(4242, 'SIGTERM', 'win32')).toEqual({ args: ['/PID', '4242', '/T', '/F'], command: 'taskkill' });
    expect(killTreePlan(4242, 'SIGTERM', 'linux')).toEqual({ signal: 'SIGTERM' });
  });

  it('plans nothing for a pid that is not ours — a failed spawn, init, a broadcast, Windows System', () => {
    for (const pid of [undefined, Number.NaN, -1, 0, 1]) expect(killTreePlan(pid, 'SIGTERM', 'linux'), `pid ${String(pid)}`).toBeNull();
    for (const pid of [undefined, 0, 4]) expect(killTreePlan(pid, 'SIGTERM', 'win32'), `pid ${String(pid)}`).toBeNull();
    expect(isKillablePid(2, 'linux')).toBe(true);
    expect(isKillablePid(5, 'win32')).toBe(true);
  });

  it('parses the options another server needs', () => {
    expect(parseArgs(['--entry=dist/main.js', '--port-env=PORT', '--path=/health', '--timeout=90', '--ready=Nest application successfully started'])).toEqual({
      bootTimeoutMs: 90_000,
      entry: 'dist/main.js',
      portEnv: 'PORT',
      readyPatterns: [/Nest application successfully started/],
      smokePath: '/health',
    });
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown argument/);
  });
});

describe('check-server-start graceful shutdown (nuxt-base-starter #49)', () => {
  it('turns the graceful-shutdown step on only when asked, in seconds', () => {
    expect(parseArgs([]).shutdownTimeoutMs).toBeUndefined();
    expect(parseArgs(['--graceful-shutdown=10']).shutdownTimeoutMs).toBe(10_000);
    expect(parseArgs(['--graceful-shutdown=0.5']).shutdownTimeoutMs).toBe(500);
  });

  it.each(['0', '-1', 'ten', ''])('refuses --graceful-shutdown=%s instead of silently skipping the step', (value) => {
    expect(() => parseArgs([`--graceful-shutdown=${value}`])).toThrow(/--graceful-shutdown needs a number/);
  });

  it('counts only exit code 0 without a signal as a clean shutdown', () => {
    expect(isCleanShutdown(0, null)).toBe(true);
    expect(isCleanShutdown(1, null)).toBe(false);
    expect(isCleanShutdown(null, 'SIGTERM')).toBe(false);
    expect(isCleanShutdown(null, 'SIGKILL')).toBe(false);
  });

  it('preloads no-op SIGTERM and SIGINT listeners, so an unhandled signal is swallowed as in PID 1', () => {
    expect(PID1_SIGNAL_PRELOAD[0]).toBe('--import');
    expect(PID1_SIGNAL_PRELOAD[1]).toMatch(/^data:text\/javascript,/);
    expect(PID1_SIGNAL_PRELOAD[1]).toContain('process.on("SIGTERM",()=>{})');
    expect(PID1_SIGNAL_PRELOAD[1]).toContain('process.on("SIGINT",()=>{})');
  });
});

describe('the check chain', () => {
  const scripts = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;

  // 10 s: Docker's and Compose's default stop_grace_period. The image runs `node .output/server/index.mjs` as PID 1,
  // and a server that needs longer is SIGKILLed by `docker stop`, so the check must not allow more.
  it.each(['check:raw', 'check:fix', 'check:naf'])('%s checks the shutdown on SIGTERM within 10 s', (name) => {
    expect(scripts[name]).toMatch(/node scripts\/check-server-start\.mjs --graceful-shutdown=10$/);
  });
});

describe('check-server-start CLI: graceful shutdown', () => {
  it('returns 0 when the server also shuts down cleanly on SIGTERM, as src/server.ts does', async () => {
    const { code, output, port } = await runFixture('ok.mjs', 10, ['--graceful-shutdown=10']);

    expect(code, output).toBe(0);
    expect(output).toMatch(process.platform === 'win32' ? /Graceful-shutdown check skipped/ : /shut down cleanly on SIGTERM/);
    expect(await portAcceptsConnections(port)).toBe(false);
  });

  it('leaves the shutdown step off unless --graceful-shutdown is passed', async () => {
    // A server without any handler passes then: the step is opt-in.
    const { code, output } = await runFixture('no-shutdown.mjs');

    expect(code, output).toBe(0);
    expect(output).not.toMatch(/SIGTERM/);
  });

  it.skipIf(process.platform === 'win32')('returns 1 when the server has no shutdown handler, as it would hang in a container', async () => {
    const { code, ms, output, port } = await runFixture('no-shutdown.mjs', 10, ['--graceful-shutdown=1']);

    expect(code, output).toBe(1);
    // "did not exit" and not "ended with signal SIGTERM": only the PID 1 preload keeps the handler-less
    // server alive. Without it the default disposition would kill it at once.
    expect(output).toMatch(/did not exit within 1 s after SIGTERM/);
    expect(ms).toBeLessThan(10_000);
    expect(await portAcceptsConnections(port)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('returns 1 when the shutdown exits with an error code', async () => {
    const { code, output, port } = await runFixture('shutdown-fails.mjs', 10, ['--graceful-shutdown=5']);

    expect(code, output).toBe(1);
    expect(output).toMatch(/exit code 1, signal - after SIGTERM/);
    expect(output).toMatch(/boom while closing/);
    expect(await portAcceptsConnections(port)).toBe(false);
  });
});

describe('check-server-start CLI', () => {
  it('returns 0 when the server boots and renders, and stops it afterwards', async () => {
    const { code, output, port } = await runFixture('ok.mjs');

    expect(code, output).toBe(0);
    // The API URL points at a released port, so SSR fetches fail fast instead of hanging.
    expect(output).toMatch(/api=http:\/\/127\.0\.0\.1:\d+/);
    expect(await portAcceptsConnections(port)).toBe(false);
  });

  it('returns 1 when the server listens but the render fails', async () => {
    const { code, output, port } = await runFixture('broken-render.mjs');

    expect(code).toBe(1);
    expect(output).toMatch(/did not render \(HTTP 500\)/);
    expect(await portAcceptsConnections(port)).toBe(false);
  });

  it('returns 1 when the server dies during boot', async () => {
    const { code, output } = await runFixture('crash.mjs');

    expect(code).toBe(1);
    expect(output).toMatch(/exited unexpectedly \(code 3/);
    expect(output).toMatch(/boom during boot/);
  });

  it('returns 1 when the server never reports ready', async () => {
    const { code, output } = await runFixture('silent.mjs', 1);

    expect(code).toBe(1);
    expect(output).toMatch(/failed to start within 1 seconds/);
  });

  it('returns 1 when the entry does not exist', async () => {
    const { code } = await runFixture('does-not-exist.mjs');

    expect(code).toBe(1);
  });

  it.skipIf(process.platform === 'win32')('escalates to SIGKILL for a server that ignores SIGTERM', async () => {
    const { code, output, port } = await runFixture('ignores-sigterm.mjs');

    expect(code, output).toBe(0);
    expect(await portAcceptsConnections(port)).toBe(false);
  });
});
