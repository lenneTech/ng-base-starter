#!/usr/bin/env node
/**
 * Verify the built server boots and renders one page, then shut it down.
 *
 * Replaces `check-server-start.sh`. The bash version needed `mktemp`, `trap`,
 * `disown`, `kill -0` and `sed`, and was reached via `bash …` — which cmd.exe
 * either cannot find or resolves to `C:\Windows\System32\bash.exe`, the WSL
 * launcher. This one uses only Node built-ins and spawns the server via
 * `process.execPath` without a shell, so it runs the same on Windows, macOS
 * and Linux.
 *
 * Behaviour (the contract other repos adopt; defaults are the Angular SSR ones of this starter):
 *   1. Allocates a free port by binding `:0` on 127.0.0.1 and releasing it.
 *   2. Allocates a second, distinct port and releases it, so it refuses
 *      connections. `NG_API_URL` / `NG_PUBLIC_API_URL` default to it: the
 *      built server never reads `.env`, and an unreachable-but-hanging API URL
 *      would make the SSR fetch loop instead of failing fast.
 *   3. Spawns `node <entry>` with `<portEnv>=<port>` (no shell).
 *   4. "Up" = a line of server output matches one of `readyPatterns`.
 *   5. Then GETs `smokePath` (30 s timeout, redirects not followed). Only a
 *      2xx or 3xx counts: a bundle can listen and still throw on every render.
 *   6. Always stops the server: SIGTERM, up to 2 s grace, then SIGKILL on POSIX;
 *      `taskkill /PID <pid> /T /F` on Windows (no signals there).
 *
 * Optional, off unless `--graceful-shutdown=<seconds>` is passed (this repo's check passes it):
 *   7. After the render, SIGTERM the server and require it to exit on its own with
 *      code 0 within that many seconds. The server is started with a no-op SIGTERM /
 *      SIGINT listener preloaded, which reproduces how a container runs it: there node
 *      is PID 1 (the Dockerfile's `CMD ["node", ".output/server/index.mjs"]`), and the
 *      kernel discards a signal whose disposition is the default, so the process ends
 *      only when a shutdown handler closes the server and the event loop drains. Without
 *      the preload a missing handler would go unnoticed here, because outside a
 *      container the default disposition kills the process at once. The preload also
 *      ends the server once the runner is gone (Ctrl-C, a watchdog), see `PID1_SIGNAL_PRELOAD`.
 *      Skipped on Windows, which delivers no SIGTERM. nest-server-starter and the Nuxt
 *      template carry the same step.
 *
 * Exit code: 0 when the server came up and rendered (and, with step 7, shut down
 * cleanly), 1 otherwise — boot timeout (`bootTimeoutMs`, default 60 s), early exit of
 * the server, a non-2xx/3xx response or no response at all, and with step 7 a server
 * that outlives the shutdown limit or exits with anything but code 0. The last 30
 * lines of server output are printed on failure.
 */
import { execFileSync, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Output dir of the build under test. The check chain builds into `.output-check`
 * (`build:check` sets `NG_OUTPUT_DIR`) and boots that same tree, so a developer's
 * `.output` is neither overwritten nor tested by accident.
 */
const OUTPUT_DIR = process.env.NG_OUTPUT_DIR || '.output';

/** Defaults for the Angular SSR build. Other servers override these via `run(options)`. */
export const NG_DEFAULTS = Object.freeze({
  bootTimeoutMs: 60_000,
  // The shim `scripts/build.mjs` writes next to Angular's `server.mjs` (the lt-monorepo contract).
  entry: `${OUTPUT_DIR}/server/index.mjs`,
  // `src/server.ts` parses PORT as an integer before it listens.
  portEnv: 'PORT',
  readyPatterns: [/listening on/i],
  smokePath: '/',
});

/** Pure: whether an HTTP status counts as "rendered". `0` means no response. */
export function isRenderedStatus(status) {
  return Number.isInteger(status) && status >= 200 && status < 400;
}

/**
 * Node arguments that make the server treat SIGTERM / SIGINT like PID 1 in a container does:
 * a no-op listener is registered before the entry loads, so a signal the app does not handle,
 * or re-raises after its own handler ran, is swallowed instead of killing the process. The
 * process then ends only when the app closes everything that keeps the event loop alive.
 * Passed as a `data:` module so nothing is written to disk.
 *
 * A server that ignores both signals must not outlive the runner: a Ctrl-C reaches the whole
 * process group, and a watchdog (lt-monorepo's `check`) SIGTERMs and then SIGKILLs the tree, so
 * the runner can end before its `finally` stops the server, which then kept listening for hours,
 * re-parented to init. The preload therefore also checks the parent every 250 ms and SIGKILLs the
 * server once it has a new one. The timer is unref'd and keeps nothing alive, so the shutdown
 * measurement is unchanged.
 */
export const PID1_SIGNAL_PRELOAD = Object.freeze([
  '--import',
  'data:text/javascript,process.on("SIGTERM",()=>{});process.on("SIGINT",()=>{});' +
    'const parent=process.ppid;setInterval(()=>{if(process.ppid!==parent)process.kill(process.pid,"SIGKILL")},250).unref();',
]);

/** Pure: whether the way a process ended counts as a clean shutdown — exit code 0, no signal. */
export function isCleanShutdown(code, signal) {
  return code === 0 && (signal === null || signal === undefined);
}

/** Pure: whether a chunk of server output signals that it is listening. */
export function isReadyOutput(text, patterns) {
  return patterns.some((re) => re.test(text));
}

/**
 * Pure: whether a number may become a kill target at all — an integer above 1 on POSIX
 * (1 is init, 0 and -1 address a group or every process of the user) and above 4 on
 * Windows (0 is System Idle, 4 is System). A failed spawn leaves `child.pid` undefined.
 */
export function isKillablePid(pid, platform = process.platform) {
  return Number.isInteger(pid) && pid > (platform === 'win32' ? 4 : 1);
}

/**
 * Pure: how to stop the server's process tree on this platform, or null when `pid` must not
 * be touched. Same contract as `killTreePlan` in lt-monorepo's check.mjs, kept local so this
 * file has no sibling imports and can be copied on its own.
 */
export function killTreePlan(pid, signal, platform = process.platform) {
  if (!isKillablePid(pid, platform)) return null;
  return platform === 'win32' ? { args: ['/PID', String(pid), '/T', '/F'], command: 'taskkill' } : { signal };
}

/** Bind `:0` on loopback, read the port, release it. */
function allocPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function allocDistinctPort(taken) {
  // An ephemeral-port collision is astronomically rare; the cap only guards
  // against a pathological loopback state.
  for (let i = 0; i < 10; i++) {
    const port = await allocPort();
    if (port !== taken) return port;
  }
  throw new Error('Could not allocate a distinct closed port after 10 attempts');
}

/** GET `url`; resolves to the status, or 0 when no response arrived. */
async function smokeRequest(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    return res.status;
  } catch {
    return 0;
  }
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stop the child's tree. Only ever called with the pid of the child we spawned. */
async function stop(child) {
  const pid = child.pid;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const plan = killTreePlan(pid, 'SIGTERM');
  if (!plan) return;
  if (plan.command) {
    try {
      execFileSync(plan.command, plan.args, { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
    return;
  }
  child.kill(plan.signal);
  // Express can take a moment to unwind its listeners; give it up to 2 s.
  for (let i = 0; i < 4 && isAlive(pid); i++) await new Promise((r) => setTimeout(r, 500));
  if (isAlive(pid)) child.kill('SIGKILL');
}

/**
 * SIGTERM the server and wait up to `timeoutMs` for it to end on its own. Resolves to how it
 * ended plus the time it took, or null when it was still running at the limit (`stop()` then
 * kills it). Only ever called with the child we spawned, on POSIX.
 */
async function shutdownWithin(child, exited, timeoutMs) {
  const plan = killTreePlan(child.pid, 'SIGTERM');
  if (!plan?.signal) return null;
  const started = Date.now();
  child.kill(plan.signal);
  let timer;
  const limit = new Promise((settle) => {
    timer = setTimeout(() => settle(null), timeoutMs);
  });
  const result = await Promise.race([exited, limit]);
  clearTimeout(timer);
  return result && { ...result, ms: Date.now() - started };
}

/**
 * Boot, smoke-test, stop. Resolves to the exit code (0 ok, 1 failed); never rejects.
 * `log` receives the human-readable report lines.
 */
export async function run(options = {}, log = console.log) {
  const opts = { ...NG_DEFAULTS, ...options };
  const cwd = opts.cwd ?? process.cwd();
  const lines = [];
  const tail = (n) => lines.slice(-n).join('\n');

  let port;
  let closedPort;
  try {
    port = await allocPort();
    closedPort = await allocDistinctPort(port);
  } catch (err) {
    log(String(err?.message || err));
    return 1;
  }
  log(`Using free port: ${port}`);

  const apiUrl = process.env.NG_API_URL || `http://127.0.0.1:${closedPort}`;
  const env = {
    ...process.env,
    NG_API_URL: apiUrl,
    NG_PUBLIC_API_URL: process.env.NG_PUBLIC_API_URL || apiUrl,
    [opts.portEnv]: String(port),
  };
  const checkShutdown = opts.shutdownTimeoutMs !== undefined && process.platform !== 'win32';
  const nodeArgs = [...(checkShutdown ? PID1_SIGNAL_PRELOAD : []), resolve(cwd, opts.entry)];
  const child = spawn(process.execPath, nodeArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  // Settles once the process is gone, however it ended; the shutdown step waits on it.
  const exited = new Promise((settle) => child.once('exit', (code, signal) => settle({ code, signal })));

  // Settles once with the first of: ready, exit, spawn error, timeout.
  const outcome = await new Promise((settle) => {
    const timer = setTimeout(() => settle({ kind: 'timeout' }), opts.bootTimeoutMs);
    const done = (result) => {
      clearTimeout(timer);
      settle(result);
    };
    let pending = '';
    const onData = (chunk) => {
      pending += chunk.toString();
      const parts = pending.split(/\r?\n/);
      pending = parts.pop();
      lines.push(...parts);
      if (isReadyOutput(parts.join('\n') + '\n' + pending, opts.readyPatterns)) done({ kind: 'ready' });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code, signal) => {
      if (pending) lines.push(pending);
      done({ code, kind: 'exited', signal });
    });
    child.once('error', (err) => done({ error: err, kind: 'error' }));
  });

  try {
    if (outcome.kind === 'ready') {
      const status = await smokeRequest(`http://127.0.0.1:${port}${opts.smokePath}`);
      if (!isRenderedStatus(status)) {
        log(`Server booted but GET ${opts.smokePath} did not render (HTTP ${status || '<no response>'}). Last 30 log lines:`);
        log(tail(30));
        return 1;
      }
      log(tail(5));
      if (opts.shutdownTimeoutMs === undefined) {
        log(`Server started and rendered GET ${opts.smokePath} with HTTP ${status} - check complete`);
        return 0;
      }
      log(`Server started and rendered GET ${opts.smokePath} with HTTP ${status}`);
      if (!checkShutdown) {
        log('Graceful-shutdown check skipped: Windows delivers no SIGTERM - check complete');
        return 0;
      }
      const seconds = opts.shutdownTimeoutMs / 1000;
      const ended = await shutdownWithin(child, exited, opts.shutdownTimeoutMs);
      if (!ended) {
        log(
          `Server did not exit within ${seconds} s after SIGTERM. In a container it would hang until the ` +
            'orchestrator kills it, dropping in-flight requests and skipping every shutdown hook. Check that ' +
            'the server installs a SIGTERM handler that closes it (`startServer()` in src/server.ts does) and ' +
            'that nothing keeps the event loop alive after close. Last 30 log lines:',
        );
        log(tail(30));
        return 1;
      }
      if (!isCleanShutdown(ended.code, ended.signal)) {
        log(`Server ended with exit code ${ended.code ?? '-'}, signal ${ended.signal ?? '-'} after SIGTERM instead of exit code 0. Last 30 log lines:`);
        log(tail(30));
        return 1;
      }
      log(`Server shut down cleanly on SIGTERM in ${(ended.ms / 1000).toFixed(1)} s - check complete`);
      return 0;
    }
    if (outcome.kind === 'exited') {
      log(`Server process exited unexpectedly (code ${outcome.code ?? '-'}, signal ${outcome.signal ?? '-'}). Full log:`);
      log(lines.join('\n'));
      return 1;
    }
    if (outcome.kind === 'error') {
      log(`Server process could not be started: ${outcome.error?.message || outcome.error}`);
      return 1;
    }
    log(`Server failed to start within ${Math.round(opts.bootTimeoutMs / 1000)} seconds. Last 30 log lines:`);
    log(tail(30));
    return 1;
  } finally {
    await stop(child);
  }
}

/**
 * Parse `--entry=…`, `--port-env=…`, `--path=…`, `--timeout=<seconds>`,
 * `--ready=<regex>` (repeatable; replaces the default ready patterns) and
 * `--graceful-shutdown=<seconds>` (turns on step 7).
 */
export function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const [key, value] = arg.split(/=(.*)/s, 2);
    if (key === '--entry') options.entry = value;
    else if (key === '--port-env') options.portEnv = value;
    else if (key === '--path') options.smokePath = value;
    else if (key === '--timeout') options.bootTimeoutMs = Number(value) * 1000;
    else if (key === '--ready') (options.readyPatterns ??= []).push(new RegExp(value));
    else if (key === '--graceful-shutdown') {
      const seconds = Number(value);
      // `!(x > 0)` also refuses NaN: a typo must not silently turn the check off.
      if (!(seconds > 0)) throw new Error(`--graceful-shutdown needs a number of seconds above 0, got: ${value}`);
      options.shutdownTimeoutMs = seconds * 1000;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

// Run only when invoked as the CLI, so tests can import the pure helpers.
function isCliEntry() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch (err) {
    // Fail closed: "cannot tell" must never become a green check that never ran.
    process.stderr.write(`[check-server-start] cannot resolve the CLI entry (${err?.code || err}) — refusing to report success\n`);
    process.exit(1);
  }
}

if (isCliEntry()) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  process.exitCode = await run(options);
}
