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
import { connect } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isKillablePid, isReadyOutput, isRenderedStatus, killTreePlan, NG_DEFAULTS, parseArgs } from '../../scripts/check-server-start.mjs';

const fixtures = join(import.meta.dirname, 'fixtures', 'server-start');
const runner = join(import.meta.dirname, '..', '..', 'scripts', 'check-server-start.mjs');

/** Run the CLI against a fixture; resolves to its exit code, output and the port it used. */
function runFixture(entry: string, timeoutSeconds = 10): Promise<{ code: null | number; output: string; port: number }> {
  // The CLI keeps an inherited NG_API_URL on purpose, and the CI test job sets one for the E2E
  // suite; the assertions here are about the default, so the fixture runs without it.
  const { NG_API_URL: _apiUrl, NG_PUBLIC_API_URL: _publicApiUrl, ...env } = process.env;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runner, `--entry=${entry}`, `--timeout=${timeoutSeconds}`], { cwd: fixtures, env });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.once('close', (code) => resolve({ code, output, port: Number(/Using free port: (\d+)/.exec(output)?.[1]) }));
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
