#!/usr/bin/env node
/**
 * Quiet, report-driven wrapper around the project `check` pipeline.
 *
 * Replaces the noisy `pnpm audit && pnpm -r --parallel run check` with:
 *   - a minimal live view — one status line per running project (spinner +
 *     current step), so you always see where the run is;
 *   - abort on the first failing step, printing the captured reason;
 *   - on success a report: the executed steps + their key metrics
 *     (vulnerabilities per level, test counts per area Unit/API/Playwright, …);
 *   - format + lint auto-fix every fixable finding (oxfmt writes, oxlint --fix);
 *     only non-fixable lint errors then remain and fail the run.
 *
 * Flags:
 *   --verbose / -v      stream the full tool output live (deep debugging)
 *   --sequential/--seq  run projects one after another (default: parallel)
 *   --no-fix            read-only gate — do not auto-fix format/lint
 *   --project=<substr>  restrict to matching workspace projects (repeatable)
 *
 * Design: the per-project `check` scripts stay the single source of truth for
 * WHAT runs. This wrapper discovers each workspace project's `check` chain,
 * splits it on `&&`, and runs the steps with status + metrics — so adding or
 * removing a step in a project's `check` needs no change here.
 *
 * Exit code: 0 when every step passed, 1 otherwise (preserves the contract the
 * lt-dev `running-check-script` skill relies on: non-zero === failed).
 */
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `null` or `undefined` (what a loose `== null` compares against, without the loose comparison). */
const isNil = (value) => value === null || value === undefined;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const SEQUENTIAL = process.argv.includes('--sequential') || process.argv.includes('--seq');
const NO_FIX = process.argv.includes('--no-fix');
const PROJECT_FILTERS = process.argv.filter((a) => a.startsWith('--project=')).map((a) => a.slice('--project='.length));
// Watchdog: kill a TEST step whose child produces NO output for this long. A
// wedged test run (workers deadlocked at 0% CPU) otherwise spins the live view
// forever — the spinner only proves the child process exists, not that it
// progresses. Only test steps are watched: build / typecheck / audit legitimately
// buffer all their output to the end (and go silent under a non-TTY pipe), so
// watching them would false-kill a slow-but-progressing run. Override with
// --idle-timeout=<seconds> or CHECK_IDLE_TIMEOUT (seconds); 0 disables it.
const IDLE_TIMEOUT_MS = (() => {
  const flag = process.argv.find((a) => a.startsWith('--idle-timeout='));
  const raw = flag ? flag.slice('--idle-timeout='.length) : process.env.CHECK_IDLE_TIMEOUT;
  const DEFAULT_MS = 300 * 1000;
  if (raw === undefined || raw === '') return DEFAULT_MS;
  const seconds = Number(raw);
  if (seconds === 0) return 0; // explicit opt-out
  // Invalid value (typo, unit suffix, negative) → keep the protection at its
  // default rather than silently disabling it — a fat-fingered value must not
  // turn the watchdog off unnoticed.
  if (!Number.isFinite(seconds) || seconds < 0) {
    process.stderr.write(`[check] ignoring invalid idle-timeout "${raw}", using ${DEFAULT_MS / 1000}s\n`);
    return DEFAULT_MS;
  }
  return seconds * 1000;
})();
// Verbose streams raw output, so the in-place live view is disabled there.
const TTY = Boolean(process.stdout.isTTY) && !VERBOSE;

// ── tiny ANSI helpers ──────────────────────────────────────────────────────
const C = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};
// oxlint-disable-next-line no-control-regex -- matching ESC is the whole point of stripping ANSI codes
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const shortRel = (rel) => rel.replace(/^projects\//, '');

function fmtDuration(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

// ── step classification ────────────────────────────────────────────────────
// Map a raw command from a `check` chain onto a stable kind + label so the
// report stays readable regardless of the underlying tool (oxfmt/oxlint/tsc/…).
function classify(cmd) {
  const c = cmd.toLowerCase();
  if (c.includes('vendor-freshness')) return { fatal: false, kind: 'vendor', label: 'vendor-freshness' };
  // Its own kind, so the summary line is parsed and an unverified run renders yellow instead of
  // the plain tick an unclassified step would get.
  if (c.includes('check-suppressions') || c.includes('check:suppressions')) return { fatal: true, kind: 'suppressions', label: 'suppressions' };
  // Same reason: the override guard exits 0 when it could not look (no audit report, advisory
  // service down), and that must not render as the tick of a run that did.
  if (c.includes('check-overrides') || c.includes('check:overrides')) return { fatal: true, kind: 'overrides', label: 'overrides' };
  if (c.includes('audit')) return { fatal: true, kind: 'audit', label: 'audit' };
  if (c.includes('format:check') || c.includes('oxfmt') || c.includes('prettier')) return { fatal: true, kind: 'format', label: 'format' };
  if (c.includes('lint')) return { fatal: true, kind: 'lint', label: 'lint' };
  if (/(^|&|\s)(pnpm\s+)?test(:|\s|$)|vitest|jest|test:unit|test:ci/.test(c)) return { fatal: true, kind: 'test', label: 'test' };
  if (c.includes('build') || c.includes('nuxt build') || c.includes('tsc')) return { fatal: true, kind: 'build', label: 'build' };
  if (c.includes('check-server-start') || c.includes('server-start')) return { fatal: true, kind: 'server', label: 'server-start' };
  return { fatal: true, kind: 'other', label: cmd.length > 32 ? `${cmd.slice(0, 29)}…` : cmd };
}

// Rewrite a check-only format/lint command into its auto-fixing variant, so a
// `check` run repairs every fixable finding instead of only reporting it.
function toFixCommand(kind, cmd) {
  if (NO_FIX) return cmd;
  if (kind === 'format') {
    if (/\bformat:check\b/.test(cmd)) return cmd.replace(/\bformat:check\b/, 'format');
    if (/\boxfmt\b/.test(cmd)) return cmd.replace(/\s--check\b/, '');
    if (/\bprettier\b/.test(cmd)) return cmd.replace(/\s--check\b/, ' --write');
    return cmd;
  }
  if (kind === 'lint') {
    if (/\blint:fix\b/.test(cmd) || /--fix\b/.test(cmd)) return cmd;
    if (/\brun\s+lint\b/.test(cmd)) return cmd.replace(/\brun\s+lint\b/, 'run lint:fix');
    // Never `--fix-suggestions`: oxlint marks suggestions as possibly behaviour-changing,
    // and the no-console one deletes every console call it touches.
    if (/\boxlint\b/.test(cmd)) return cmd.replace(/\boxlint\b/, 'oxlint --fix');
    return cmd;
  }
  return cmd;
}

// ── metric parsers ─────────────────────────────────────────────────────────
// Sum capture group 1 across every match of `re` (which must carry the `g` flag).
// Returns null when nothing matched, so callers can tell "absent" from "zero".
function sumMatches(clean, re) {
  let total = null;
  for (const m of clean.matchAll(re)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) total = (total ?? 0) + n;
  }
  return total;
}
// A single test step may invoke vitest more than once (e.g. `vitest:unit && vitest`),
// emitting one summary block per run. Sum them all — reading only the first
// silently under-reports every later run.
function parseVitest(out) {
  const clean = stripAnsi(out);
  const passed = sumMatches(clean, /Tests\s+(?:\d+\s+failed[^\n]*?)?(\d+)\s+passed/gi);
  const files = sumMatches(clean, /Test Files\s+(?:\d+\s+failed[^\n]*?)?(\d+)\s+passed/gi);
  const failed = sumMatches(clean, /Tests\s+(\d+)\s+failed/gi);
  if (isNil(passed) && isNil(files)) return null;
  return {
    failed: failed ?? 0,
    files,
    passed,
  };
}
function parseLint(out) {
  const clean = stripAnsi(out);
  const summary = clean.match(/Found\s+(\d+)\s+warnings?(?:\s+and\s+(\d+)\s+errors?)?/i);
  if (summary) return { errors: summary[2] ? Number(summary[2]) : 0, warnings: Number(summary[1]) };
  return {
    errors: (clean.match(/\berror\b/gi) || []).length,
    warnings: (clean.match(/\bwarning\b/g) || []).length,
  };
}

// ── audit (faithful: runs the project's OWN audit command) ──────────────────
const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];

// Run the audit command exactly as the check chain defines it (same scope /
// --prod / --audit-level), only appending --json for the counts. The gate is
// the command's own exit code, so `check` blocks precisely when a bare
// `<auditCmd>` would — never with a narrower scope than the chain. (The old
// hardcoded `--prod` hid devDependency vulns for library packages.)
async function runAudit(auditCmd) {
  const cmd = /(^|\s)--json(\s|$)/.test(auditCmd) ? auditCmd : `${auditCmd} --json`;
  const { code, out } = await capture(cmd, ROOT);
  let counts = null;
  try {
    counts = JSON.parse(out.slice(out.indexOf('{')))?.metadata?.vulnerabilities ?? null;
  } catch {
    /* fall through to raw reason */
  }
  const total = counts ? SEVERITIES.reduce((n, s) => n + (counts[s] || 0), 0) : 0;
  return { auditCmd, blocking: code !== 0, counts, reason: counts ? null : out, total };
}

// ── command runner ─────────────────────────────────────────────────────────
const RUNNING = new Set();

/**
 * Whether a number may become a kill target at all.
 *
 * A spawn that failed leaves `child.pid` undefined. On POSIX that only made `pgrep` and
 * `process.kill` throw, but on Windows it became `taskkill /PID undefined /T /F` — a kill
 * command built from a word that is not a pid. And the small numbers are not processes you
 * own: POSIX pid 1 is init/launchd, and 0 and -1 are the group and the kill(2) broadcast to
 * every process of the user (the shape that rebooted a Mac on 2026-09-23). Windows reserves
 * 0 (System Idle) and 4 (System). Nothing a check step spawns can have any of these pids.
 */
export function isKillablePid(pid, platform = process.platform) {
  return Number.isInteger(pid) && pid > (platform === 'win32' ? 4 : 1);
}

/**
 * How to kill a process tree on this platform, or null when `pid` must not be touched.
 *
 * Windows has neither `pgrep` nor signals: `process.kill(pid, 'SIGTERM')` there ends the one
 * process and orphans its children, and `taskkill /T` alone was measured to leave the tree
 * running ("Die Beendigung dieses Prozesses muss erzwungen werden") with the port still held.
 * `/F` is what actually frees it, so the whole tree is force-killed in one call.
 *
 * The consequence is worth stating, because it is a behaviour difference and not an
 * implementation detail: on Windows there is no graceful stage. The SIGTERM call already
 * terminates, so a child's graceful-shutdown hook does not run — a server gets no chance to
 * close connections or flush. The SIGKILL escalation five seconds later then finds nothing.
 *
 * Split out as a pure function so both branches can be tested from either platform.
 */
export function killTreePlan(pid, signal, platform = process.platform) {
  if (!isKillablePid(pid, platform)) return null;
  return platform === 'win32' ? { args: ['/PID', String(pid), '/T', '/F'], command: 'taskkill' } : { signal };
}

/**
 * Kill `pid` and its whole process tree, with every effect injected.
 *
 * Injecting the platform alone is not enough: the effects would still run for real, against
 * this machine, with whatever pid the test chose. So all four are required and nothing
 * defaults — a test cannot reach a real `taskkill`, `pgrep` or `process.kill` by leaving one
 * out. `killTree` below is the only caller that passes the real ones.
 *
 * - `run(command, args)` executes the Windows plan.
 * - `childrenOf(pid)` returns the direct children of `pid` (POSIX).
 * - `signal(pid, sig)` delivers `sig` to `pid` (POSIX).
 *
 * POSIX order is leaves first, so a parent cannot respawn a child that was just killed, and
 * each pid is signalled at most once. Pids a lookup returns pass the same check as the root —
 * a stray 1 in `pgrep` output must not become a signal to init.
 */
export function killTreeWith(pid, sig, { childrenOf, platform, run, signal }) {
  for (const [name, fn] of Object.entries({ childrenOf, run, signal })) {
    if (typeof fn !== 'function') throw new TypeError(`killTreeWith: \`${name}\` must be injected`);
  }
  if (typeof platform !== 'string') throw new TypeError('killTreeWith: `platform` must be injected');
  const plan = killTreePlan(pid, sig, platform);
  if (!plan) return;
  if (plan.command) {
    try {
      run(plan.command, plan.args);
    } catch {
      /* already gone, or taskkill refused — nothing further to try */
    }
    return;
  }
  const seen = new Set();
  const order = [];
  const collect = (p) => {
    if (seen.has(p) || !isKillablePid(p, platform)) return;
    seen.add(p);
    let children = [];
    try {
      children = childrenOf(p);
    } catch {
      /* no children */
    }
    for (const c of children) collect(c);
    order.push(p);
  };
  collect(pid);
  for (const p of order) {
    try {
      signal(p, plan.signal);
    } catch {
      /* already gone */
    }
  }
}

/** Direct children of `pid` via `pgrep -P`; empty when there are none (pgrep exits 1). */
function pgrepChildren(pid) {
  const out = execFileSync('pgrep', ['-P', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
  return out ? out.split('\n').map(Number) : [];
}

// Best-effort kill of a child's whole process tree (sh → pnpm → vitest →
// fork workers). Killing only the direct child orphans the tree — exactly the
// zombie workers a deadlock leaves behind.
function killTree(child, signal = 'SIGTERM') {
  killTreeWith(child.pid, signal, {
    childrenOf: pgrepChildren,
    platform: process.platform,
    run: (command, args) => execFileSync(command, args, { stdio: 'ignore' }),
    signal: (pid, sig) => process.kill(pid, sig),
  });
}

// idleTimeoutMs > 0 arms the no-output watchdog for this child; 0 (the default)
// runs it unwatched. Only callers that KNOW the child streams progress (test
// steps) should pass a timeout — see runGroup.
function capture(cmd, cwd, idleTimeoutMs = 0) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true });
    RUNNING.add(child);
    let out = '';
    let idleTimer = null;
    let killTimer = null;
    let watchdogHit = false;
    // Any output resets the watchdog — only complete silence for the full
    // window counts as wedged. Escalate to SIGKILL for processes that ignore
    // SIGTERM (deadlocked event loops usually still honor TERM, but be sure).
    const armWatchdog = () => {
      if (!idleTimeoutMs) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        watchdogHit = true;
        killTree(child);
        // Track the SIGKILL escalation so a child that honors SIGTERM and exits
        // within the grace window cancels it in done() — otherwise the stray
        // timer could SIGKILL an unrelated process that reused the freed PID.
        killTimer = setTimeout(() => killTree(child, 'SIGKILL'), 5000);
        killTimer.unref();
      }, idleTimeoutMs);
    };
    const onData = (d) => {
      out += d;
      armWatchdog();
      if (VERBOSE) process.stdout.write(d);
    };
    armWatchdog();
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const done = (code, extra) => {
      clearTimeout(idleTimer);
      clearTimeout(killTimer);
      RUNNING.delete(child);
      if (watchdogHit) {
        const note =
          `[watchdog] step produced no output for ${Math.round(idleTimeoutMs / 1000)}s — ` +
          'process tree killed as deadlocked. This is a hang (workers idle at 0% CPU), ' +
          `not a slow run. Re-run the step directly to debug: \`${cmd}\``;
        return resolve({ code: 1, out: `${out}\n${note}` });
      }
      resolve({ code, out: extra ? `${out}\n${extra}` : out });
    };
    child.on('close', (code) => done(code ?? 1));
    child.on('error', (err) => done(1, err.message));
  });
}
function killAll() {
  for (const child of RUNNING) {
    try {
      killTree(child);
    } catch {
      /* already gone */
    }
  }
}

// ── live multi-line status (one line per running project) ────────────────────
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let liveCount = 0;
let frame = 0;
function drawLive(lines) {
  if (!TTY) return;
  if (liveCount > 0) process.stdout.write(`\x1b[${liveCount}A`);
  for (const l of lines) process.stdout.write(`\r\x1b[K${l}\n`);
  liveCount = lines.length;
}
function statusLines(order, states) {
  frame += 1;
  return order.map((rel) => {
    const s = states.get(rel);
    if (s.failed) return `${C.red('✗')} ${shortRel(rel).padEnd(5)} ${C.red(`${s.failed} FAILED`)}`;
    if (s.done) return `${C.green('✓')} ${shortRel(rel).padEnd(5)} ${C.dim(`done (${fmtDuration(s.total)})`)}`;
    const spin = C.cyan(FRAMES[frame % FRAMES.length]);
    const el = s.stepStart ? C.dim(` (${fmtDuration(Date.now() - s.stepStart)})`) : '';
    return `${spin} ${shortRel(rel).padEnd(5)} ${s.current || 'queued'}${el}`;
  });
}

// ── project discovery + step grouping ────────────────────────────────────────
const IS_ORCHESTRATOR = (script) => !script || script.includes('check.mjs');

// Read the `packages:` globs from pnpm-workspace.yaml (monorepos). A simple
// value-list parse — enough for the globs lt projects use (e.g. `projects/*`).
function workspaceGlobs() {
  let text;
  try {
    text = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  } catch {
    return [];
  }
  const globs = [];
  let inPackages = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '');
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
      if (m) globs.push(m[1]);
      else if (line.trim() && !/^\s/.test(line)) break; // next top-level key
    }
  }
  return globs;
}

// Expand a workspace glob to concrete directories (handles `dir/*` and literals).
function expandGlob(glob) {
  if (glob.endsWith('/*')) {
    const base = glob.slice(0, -2);
    try {
      return readdirSync(join(ROOT, base), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(base, d.name));
    } catch {
      return [];
    }
  }
  return [glob];
}

function asProject(rel, check) {
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(rel === '.' ? join(ROOT, 'package.json') : join(ROOT, rel, 'package.json'), 'utf8'));
  } catch {
    /* keep defaults */
  }
  return { check, dir: rel === '.' ? ROOT : join(ROOT, rel), name: pkg.name || rel, rel };
}

// Workspace sub-projects and their real check chain; if there are none (a
// single-package repo), fall back to the root project — whose real chain lives
// in `check:raw`, because the root `check` is THIS wrapper.
//
// A member's `check` is frequently THIS wrapper too: the lt starters ship their
// own scripts/check.mjs so they also work standalone (`lt server create`), and
// `lt fullstack init` clones them verbatim into projects/*. Treating that as
// "no real chain" silently dropped EVERY member — the run then fell back to the
// root, whose chain is just `pnpm -r run check`, and reported the whole
// monorepo as one opaque step with "no test step / 0 passed" while the members'
// tests were in fact running, unseen. So resolve a member exactly like the root:
// wrapper `check` means the real chain lives in `check:raw`.
function realChain(pkg) {
  if (!IS_ORCHESTRATOR(pkg.scripts?.check)) return pkg.scripts?.check ?? null;
  return pkg.scripts?.['check:raw'] ?? null;
}

function discoverProjects() {
  const projects = [];
  for (const glob of workspaceGlobs()) {
    for (const rel of expandGlob(glob)) {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(join(ROOT, rel, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      const chain = realChain(pkg);
      if (chain) projects.push(asProject(rel, chain));
    }
  }
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const rootChain = root.scripts?.['check:raw'] ?? (IS_ORCHESTRATOR(root.scripts?.check) ? null : root.scripts?.check);
  if (projects.length === 0) {
    if (rootChain) projects.push(asProject('.', rootChain));
  } else if (rootChain) {
    // With members present, the root's own chain must not be dropped: beyond
    // install/audit (hoisted later) and the member fan-out (replaced by the
    // member expansion above) it may carry root-ONLY steps — in the assembled
    // monorepo that is `check:workspace` / `check:pin`, which exist precisely
    // for the case where members are present. Strip the fan-out command and
    // keep whatever remains as a root project.
    const ownSteps = rootChain
      .split('&&')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((c) => !/\bpnpm\s+(?:-r|--recursive)\b.*\brun\s+check\b/.test(c));
    if (ownSteps.length) projects.unshift(asProject('.', ownSteps.join(' && ')));
  }
  if (PROJECT_FILTERS.length) return projects.filter((p) => PROJECT_FILTERS.some((f) => p.rel.includes(f) || p.name.includes(f)));
  return projects;
}

// One group per project: its ordered, fix-mapped steps. The audit step is
// hoisted to a single workspace-level run; its EXACT command (scope + level +
// package manager) is captured so the run mirrors the chain's own audit.
export function buildGroups(projects) {
  let auditCmd = null;
  const groups = projects.map((project) => {
    const steps = [];
    for (const raw of project.check
      .split('&&')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const meta = classify(raw);
      if (meta.kind === 'audit') {
        if (!auditCmd) auditCmd = raw;
        continue;
      }
      steps.push({ ...meta, cmd: toFixCommand(meta.kind, raw), cwd: project.dir });
    }
    return { project, steps };
  });
  return { auditCmd, groups };
}

// A child killed by a signal surfaces through the package manager as a
// "Command failed with exit code 143/137" line (SIGTERM/SIGKILL), NOT as a test
// assertion failure — and the outer shell then reports its own generic exit 1,
// so `code` alone never reveals it. Surface the signal so the reason isn't
// mistaken for a real failure: the usual cause is resource pressure (parallel
// checks/builds swapping the machine) or an external kill.
function signalExitHint(out) {
  const clean = stripAnsi(out);
  // The watchdog also kills via SIGTERM, so pnpm's "exit code 143" ends up in
  // the output — but that path already carries its own [watchdog] note with the
  // correct (deadlock) diagnosis. Don't stack a contradictory "external kill"
  // hint on top of it.
  if (/\[watchdog\]/.test(clean)) return null;
  // Match the package manager's OWN failure line, not an arbitrary "exit code
  // 143" a test happens to log, so a real assertion failure isn't mislabeled.
  const m = clean.match(/Command failed with exit code (137|143)\b/);
  if (!m) return null;
  const sig = m[1] === '143' ? 'SIGTERM' : 'SIGKILL';
  return (
    `[check] step ended via ${sig} (exit ${m[1]}) — the process was killed, not an assertion failure. ` +
    'Usual cause: resource pressure (parallel checks/builds swapping) or an external kill. ' +
    "Re-run this project's check alone to confirm."
  );
}

// ── per-project runner ───────────────────────────────────────────────────────
// Runs a group's steps in order, recording results + live state. Stops early
// when another project already failed (abort.hit).
async function runGroup(group, states, results, abort) {
  const rel = group.project.rel;
  const st = states.get(rel);
  const startedAt = Date.now();
  for (const step of group.steps) {
    if (abort.hit) return;
    st.current = step.label;
    st.stepStart = Date.now();
    if (!TTY) process.stdout.write(`  ${C.dim('→')} ${shortRel(rel)} · ${step.label}\n`);
    // Watchdog only on test steps (see IDLE_TIMEOUT_MS): a test runner streams
    // output continuously, so prolonged silence == deadlocked workers. Other
    // steps buffer their output and must run unwatched.
    const { code, out } = await capture(step.cmd, step.cwd, step.kind === 'test' ? IDLE_TIMEOUT_MS : 0);
    const dur = Date.now() - st.stepStart;
    const r = { dur, kind: step.kind, label: step.label, project: rel };
    if (step.kind === 'test') r.tests = parseVitest(out);
    if (step.kind === 'lint') r.lint = parseLint(out);
    if (step.kind === 'suppressions') r.suppressions = parseSuppressionSummary(out);
    if (step.kind === 'overrides') r.overrides = parseOverridesSummary(out);
    results.push(r);
    if (code !== 0 && step.fatal) {
      st.failed = step.label;
      if (!abort.hit) {
        abort.hit = true;
        const hint = signalExitHint(out);
        abort.failure = { out: hint ? `${out}\n${hint}` : out, project: rel, step: `${shortRel(rel)} · ${step.label}` };
        killAll();
      }
      return;
    }
    if (!TTY) process.stdout.write(`  ${C.green('✓')} ${shortRel(rel)} · ${step.label}${metricSuffix(r)} ${C.dim(`(${fmtDuration(dur)})`)}\n`);
  }
  st.done = true;
  st.total = Date.now() - startedAt;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const started = Date.now();
  const projects = discoverProjects();
  if (projects.length === 0) {
    console.error(C.red('No workspace projects with a `check` script found.'));
    process.exit(1);
  }
  const { auditCmd, groups } = buildGroups(projects);
  const stepCount = groups.reduce((n, g) => n + g.steps.length, 0) + (auditCmd ? 1 : 0);
  const mode = SEQUENTIAL ? 'sequential' : 'parallel';
  const pkgName = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name;

  console.log(C.bold(`\nRunning checks for ${C.cyan(pkgName)}`));
  console.log(
    C.dim(
      `${projects.length} project(s) · ${stepCount} steps · ${mode} · audit: ${auditCmd ?? 'none'}` +
        `${NO_FIX ? '' : ' · auto-fix format+lint'}` +
        ` · watchdog: ${IDLE_TIMEOUT_MS ? `${fmtDuration(IDLE_TIMEOUT_MS)} (tests)` : 'off'}` +
        `${VERBOSE ? ' · verbose' : ''}\n`,
    ),
  );

  const results = [];

  // Step 0 — single workspace audit (blocking gate, runs before the fan-out).
  // Mirrors the chain's own audit command (scope/level/PM); skipped only when
  // the chain has no audit step.
  if (auditCmd) {
    const t = Date.now();
    if (!TTY) process.stdout.write(`  ${C.dim('→')} audit\n`);
    else drawLive([`${C.cyan(FRAMES[0])} audit`]);
    const audit = await runAudit(auditCmd);
    const dur = Date.now() - t;
    if (audit.blocking) {
      liveCount = 0; // the failure line must survive — nothing may overwrite it
      const summary = audit.counts ? `${audit.total} vuln (${renderVulnLine(audit.counts)})` : 'failed';
      console.log(`${C.red('✗')} audit  ${C.red(summary)} ${C.dim(`(${fmtDuration(dur)})`)}`);
      return fail(`audit (${String(auditCmd)})`, audit.counts ? renderVulnLine(audit.counts) : audit.reason, started);
    }
    if (!TTY) {
      process.stdout.write(`  ${C.green('✓')} audit  ${audit.counts ? renderVulnLine(audit.counts) : C.dim('0')} ${C.dim(`(${fmtDuration(dur)})`)}\n`);
    }
    // TTY success: NO permanent line — the live status view overwrites the audit
    // row (like every other step); the result lands in the report twice: the
    // Steps list (entry below) and the Vulnerabilities section.
    results.push({ audit, kind: 'audit' });
    results.push({ dur, kind: 'step', label: 'audit', project: '.' });
  }

  // Per-project steps — parallel by default, serial with --sequential.
  const order = groups.map((g) => g.project.rel);
  const states = new Map(order.map((rel) => [rel, { current: 'queued' }]));
  const abort = { failure: null, hit: false };
  const ticker = TTY ? setInterval(() => drawLive(statusLines(order, states)), 80) : null;
  if (TTY) drawLive(statusLines(order, states));

  if (SEQUENTIAL) {
    for (const g of groups) {
      await runGroup(g, states, results, abort);
      if (abort.hit) break;
    }
  } else {
    await Promise.all(groups.map((g) => runGroup(g, states, results, abort)));
  }

  if (ticker) clearInterval(ticker);
  if (TTY) drawLive(statusLines(order, states)); // final frame

  if (abort.hit) return fail(abort.failure.step, abort.failure.out, started);

  report(started, results);
  process.exit(0);
}

// ── rendering helpers ─────────────────────────────────────────────────────────
function renderVulnLine(counts) {
  return SEVERITIES.map((s) => {
    const n = counts[s] || 0;
    const txt = `${s} ${n}`;
    if (n > 0 && (s === 'critical' || s === 'high')) return C.red(txt);
    return n > 0 ? C.yellow(txt) : C.dim(txt);
  }).join(C.dim(' · '));
}

/**
 * Read the summary line of `scripts/check-suppressions.mjs` back out of its output, or null when
 * there is none. Null renders as no metric at all — never as "verified": a step that printed
 * nothing readable did not verify anything. Parsed here rather than imported, because this runner
 * stays free of sibling imports.
 */
export function parseSuppressionSummary(out) {
  const text = stripAnsi(String(out));
  if (/\[suppressions\] none declared/.test(text)) return { count: 0, state: 'none', total: 0 };
  const m = text.match(/\[suppressions\] (OBSOLETE|RE-TEST|NOT verified|verified) (\d+) of (\d+)/);
  if (!m) return null;
  const state = m[1] === 'OBSOLETE' ? 'obsolete' : m[1] === 'RE-TEST' ? 'retest' : m[1] === 'verified' ? 'verified' : 'unverified';
  return { count: Number(m[2]), state, total: Number(m[3]) };
}

/**
 * Read the verdict of `scripts/check-overrides.mjs` back out of its output, or null when there is
 * none. The guard exits 0 on its degraded paths — no audit report, npm's advisory service down, a
 * suppression the Advisory API did not answer for — so the exit code cannot tell "verified" from
 * "could not look". Parsed rather than imported, like `parseSuppressionSummary`.
 */
export function parseOverridesSummary(out) {
  const text = stripAnsi(String(out));
  if (/\[overrides\] ok — no overrides and no suppressions declared/.test(text)) return { overrides: 0, state: 'none' };
  if (/\[overrides\] WARN — (could not obtain an audit report|the audit reported an empty tree)/.test(text)) return { overrides: 0, state: 'unverified' };
  const m = text.match(/\[overrides\] ok — (\d+) override\(s\) checked/);
  if (!m) return null;
  const s = text.match(/; (\d+)\/(\d+) suppression\(s\) verified/);
  return { overrides: Number(m[1]), state: s && Number(s[1]) < Number(s[2]) ? 'unverified' : 'verified' };
}

function metricSuffix(r) {
  if (r.kind === 'test' && !isNil(r.tests?.passed)) {
    const failed = r.tests.failed ? C.red(` / ${r.tests.failed} failed`) : '';
    return `  ${C.dim(`${r.tests.passed} passed${!isNil(r.tests.files) ? ` / ${r.tests.files} files` : ''}`)}${failed}`;
  }
  // Unverified is yellow, never a plain tick: an entry nobody could check has not been checked.
  if (r.kind === 'suppressions' && r.suppressions) {
    const s = r.suppressions;
    if (s.state === 'verified') return `  ${C.dim(`${s.total} verified`)}`;
    if (s.state === 'none') return `  ${C.dim('none declared')}`;
    if (s.state === 'unverified') return `  ${C.yellow(`${s.count} of ${s.total} NOT verified`)}`;
    if (s.state === 'retest') return `  ${C.red(`${s.count} to re-test`)}`;
    return `  ${C.red(`${s.count} obsolete`)}`;
  }
  if (r.kind === 'overrides' && r.overrides) {
    const o = r.overrides;
    if (o.state === 'none') return `  ${C.dim('none declared')}`;
    if (o.state === 'unverified') return `  ${C.yellow('NOT verified')}`;
    return `  ${C.dim(`${o.overrides} checked`)}`;
  }
  if (r.kind === 'lint' && r.lint) {
    return r.lint.warnings > 0 ? `  ${C.yellow(`${r.lint.warnings} warning${r.lint.warnings === 1 ? '' : 's'}`)}` : `  ${C.dim('clean')}`;
  }
  return '';
}

function fail(stepLabel, reason, started) {
  console.log(`\n${C.red(`──── reason · ${stepLabel} ────`)}`);
  console.log(stripAnsi(String(reason)).trimEnd().split('\n').slice(-40).join('\n'));
  console.log(C.red('────────────────────────────────────────\n'));
  console.log(C.bold(C.red(`✗ Check FAILED at step "${stepLabel}" after ${fmtDuration(Date.now() - started)}.`)));
  console.log(C.dim('Re-run with --verbose for the full output of every step.'));
  process.exit(1);
}

function report(started, results) {
  const audit = results.find((r) => r.kind === 'audit')?.audit;
  const tests = results.filter((r) => r.kind === 'test');
  const unit = tests.find((r) => r.project?.includes('app'))?.tests;
  const api = tests.find((r) => r.project?.includes('api'))?.tests;
  const totalPassed = tests.reduce((n, r) => n + (r.tests?.passed || 0), 0);

  const bar = '═'.repeat(52);
  console.log(`\n${C.green(bar)}`);
  console.log(C.bold(`  ${C.green('✓ Check PASSED')}  ${C.dim(`(${fmtDuration(Date.now() - started)})`)}`));
  console.log(C.green(bar));

  console.log(`\n${C.bold('Steps')}`);
  const steps = results.filter((x) => x.kind !== 'audit');
  // Group by project when more than one is involved: workspace-level steps
  // (hoisted install/audit, root-only checks) under "monorepo", then one block
  // per member. Steps within a project run sequentially, so per-group order is
  // chain order. A single-project run keeps the flat list — a header is noise.
  const stepGroups = [...new Set(steps.map((r) => r.project))].sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : shortRel(a).localeCompare(shortRel(b))));
  if (stepGroups.length > 1) {
    for (const project of stepGroups) {
      console.log(`  ${C.bold(project === '.' ? 'monorepo' : shortRel(project))}`);
      for (const r of steps.filter((x) => x.project === project)) {
        console.log(`    ${C.green('✓')} ${r.label.padEnd(24)}${metricSuffix(r) || '  '} ${C.dim(`(${fmtDuration(r.dur)})`)}`);
      }
    }
  } else {
    for (const r of steps) {
      console.log(`  ${C.green('✓')} ${`${shortRel(r.project)} · ${r.label}`.padEnd(26)}${metricSuffix(r) || '  '} ${C.dim(`(${fmtDuration(r.dur)})`)}`);
    }
  }

  console.log(`\n${C.bold('Vulnerabilities')} ${C.dim(audit ? `(${audit.auditCmd})` : '(no audit step)')}`);
  console.log(`  ${audit?.counts ? renderVulnLine(audit.counts) : C.dim(audit ? 'counts unavailable' : '—')}`);

  console.log(`\n${C.bold('Tests')}`);
  if (unit || api) {
    // Monorepo with app and/or api projects → the canonical area breakdown.
    console.log(`  ${'Unit (app)'.padEnd(18)}${!isNil(unit?.passed) ? `${unit.passed} passed` : C.dim('—')}`);
    console.log(`  ${'API (api)'.padEnd(18)}${!isNil(api?.passed) ? `${api.passed} passed` : C.dim('—')}`);
    console.log(`  ${'Playwright'.padEnd(18)}${C.dim('— (run via `lt dev test` / CI)')}`);
  } else {
    // Single-package repo → one line per test-bearing project.
    for (const r of tests) console.log(`  ${shortRel(r.project).padEnd(18)}${!isNil(r.tests?.passed) ? `${r.tests.passed} passed` : C.dim('—')}`);
    if (tests.length === 0) console.log(`  ${C.dim('no test step')}`);
  }
  console.log(`  ${C.bold('Total'.padEnd(18))}${C.bold(`${totalPassed} passed`)}`);

  console.log(`\n${C.green('All checks passed.')}\n`);
}

// Run only when invoked as the CLI (`node scripts/check.mjs`). Importing this
// module — tests/unit/nuxt-builddir-isolation.test.ts does, to assert the pure
// helpers — must never kick off a full check run.
function isCliEntry() {
  const entry = process.argv[1];
  // No argv[1] means node was started WITHOUT a script path (`node -e "…"`, which is
  // how tests/unit/nuxt-builddir-isolation.test.ts reaches the pure helpers). That is
  // not a "cannot tell" — `node scripts/check.mjs` always sets argv[1] — so it is
  // safe to answer "not the entry". Exiting here instead would kill every legitimate
  // importer, including the test runner, which is a worse failure than the
  // theoretical wrapper it would protect. The catch below is different: there argv[1]
  // EXISTS but cannot be resolved, and "cannot tell" must not become "all passed".
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch (err) {
    // Fail CLOSED. Returning false here would make `node scripts/check.mjs`
    // print nothing and exit 0 — a green gate that never ran. "Cannot tell" must
    // never be reported as "everything passed".
    process.stderr.write(`[check] cannot resolve the CLI entry (${err?.code || err}) — refusing to report success\n`);
    process.exit(1);
  }
}

if (isCliEntry()) {
  main().catch((err) => {
    console.error(C.red(`\ncheck.mjs crashed: ${err?.stack || err}`));
    process.exit(1);
  });
}
