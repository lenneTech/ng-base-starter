#!/usr/bin/env node
/**
 * `pnpm run check:baseline`: does the starter still look like a fresh `ng new` of the pinned Angular CLI?
 *
 * Decision (Kai, 2026-11-06): ng-base-starter looks exactly as if the current Angular CLI had created it and follows
 * the official best practices; every deviation is a lenne.Tech contract point with a written reason. This gate makes
 * that checkable instead of a claim. Run it before every release and after every `ng update`.
 *
 * What it does:
 * 1. Generates a reference project with the CLI version pinned in package.json (`npx @angular/cli@<version> new`,
 *    the flags in `NG_NEW_ARGS`) into a temp dir. The local CLI cannot do it: it finds this repo's angular.json from
 *    its own install location and refuses `ng new` inside a workspace.
 * 2. Formats the reference with this repo's oxfmt config, so formatting alone never counts as a deviation.
 * 3. Compares file by file, and JSON files key by key. Every difference must be listed in `ALLOWED` with a reason;
 *    an `ALLOWED` entry that no longer matches a difference is reported as stale, so the list cannot outlive its cause.
 *
 * Exit code: 0 when every deviation is allowed and no allowance is stale, 1 otherwise, 2 when the reference could not
 * be generated (offline without the CLI in the npx cache).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The project name matches this repo's angular.json project key (`app`), so build targets compare 1:1. */
export const NG_NEW_ARGS = [
  'new',
  'app',
  '--ssr',
  '--style=tailwind',
  '--routing',
  '--zoneless',
  '--strict',
  '--ai-config=claude-code',
  '--skip-install',
  '--skip-git',
  '--package-manager=pnpm',
  '--defaults',
];

/**
 * Every allowed deviation. `path` is the file; `key` (JSON files only) is the key path as an array of segments (package
 * names contain dots), `*` matches one segment and a trailing `**` everything below. `kind`: `absent` (the CLI file is deliberately missing here), `content` (the
 * file differs as a whole), `value` (a JSON key differs or is missing), `extra` (a JSON key exists only here).
 */
export const ALLOWED = [
  // ── files ──────────────────────────────────────────────────────────────────────────────────────────────────────
  { kind: 'absent', path: '.prettierrc', reason: 'oxfmt formats everything (lt stack, plan §5.4); `.oxfmtrc.jsonc` carries the same style' },
  { kind: 'absent', path: 'src/app/app.css', reason: 'Tailwind utility classes only, no component styles (stack rule); an empty file would also match a legacy blob' },
  { kind: 'content', path: '.editorconfig', reason: 'lt stack editorconfig (LF line endings for Windows/WSL, Markdown exceptions), same as nuxt-base-starter' },
  { kind: 'content', path: '.gitignore', reason: 'lt entries: .output*, .lt-dev, **/.claude/agent-memory, Playwright output; all CLI entries kept in spirit' },
  {
    key: ['mcpServers', 'angular-cli', 'args'],
    kind: 'value',
    path: '.mcp.json',
    reason: 'local, pinned CLI (`npx ng mcp`) instead of `npx -y @angular/cli` (= @latest, registry lookup on every start)',
  },
  { key: ['configurations'], kind: 'value', path: '.vscode/launch.json', reason: 'debug against `pnpm run dev` on port 3001 (backend contract), no Karma config' },
  { key: ['tasks'], kind: 'value', path: '.vscode/tasks.json', reason: 'one task, `pnpm run dev`' },
  { key: ['recommendations'], kind: 'value', path: '.vscode/extensions.json', reason: 'adds the oxc extension (oxlint/oxfmt)' },
  { kind: 'content', path: 'CLAUDE.md', reason: 'CLI rules block verbatim plus the lt stack section (tests/unit/agent-docs-contract.test.ts pins the block)' },
  { kind: 'content', path: 'README.md', reason: 'the starter README (use, develop, configure, deploy) instead of the CLI stub' },
  { kind: 'content', path: 'pnpm-workspace.yaml', reason: 'settings-only file without `packages:` (lt-monorepo hoists it), overrides and audit config with reasons' },
  { kind: 'content', path: 'src/app/app.html', reason: 'app shell instead of the CLI welcome page' },
  { kind: 'content', path: 'src/app/app.ts', reason: 'root shell without the CLI title signal; layouts are route components below it' },
  { kind: 'content', path: 'src/app/app.spec.ts', reason: 'spec of the root shell instead of the CLI title test' },
  { kind: 'content', path: 'src/app/app.config.ts', reason: 'ng-base providers, HTTP client, event replay' },
  { kind: 'content', path: 'src/app/app.routes.ts', reason: 'the routes of the Nuxt template (plan §4 row 28), lazy loaded' },
  {
    kind: 'content',
    path: 'src/app/app.routes.server.ts',
    reason: 'render mode per route (Server/Client like the Nuxt template), nothing prerendered: every response carries the runtime config of its stage',
  },
  { kind: 'content', path: 'src/index.html', reason: 'German document (`lang="de"`), title and meta description' },
  {
    kind: 'content',
    path: 'src/server.ts',
    reason: 'lt server: security headers, HTML no-cache, build identity, robots/sitemap, NG_* runtime config, PORT/HOST, `startServer()` for the shim',
  },
  { kind: 'content', path: 'src/styles.css', reason: 'Tailwind scan limited to src/, ng-base core plus per-component CSS, typography plugin' },
  // ── angular.json ───────────────────────────────────────────────────────────────────────────────────────────────
  { key: ['cli', 'analytics'], kind: 'extra', path: 'angular.json', reason: 'no CLI usage analytics prompt in CI and generated projects' },
  {
    key: ['projects', 'app', 'architect', 'build', 'options', 'outputPath'],
    kind: 'extra',
    path: 'angular.json',
    reason: '`.output` (lt-monorepo CI, Dockerfile and `lt dev test` start `.output/server/index.mjs`)',
  },
  {
    key: ['projects', 'app', 'architect', 'build', 'options', 'allowedCommonJsDependencies'],
    kind: 'extra',
    path: 'angular.json',
    reason: 'CommonJS modules the app needs: `qrcode` (2FA QR code, lazy security page) and `url-parse` (tus-js-client, ng-base file upload); without them every build warns',
  },
  {
    key: ['projects', 'app', 'architect', 'build', 'options', 'security', 'allowedHosts'],
    kind: 'value',
    path: 'angular.json',
    reason: 'localhost, 127.0.0.1 (Docker health check) and *.localhost (`lt dev`); deployed hosts come from NG_PUBLIC_SITE_URL/NG_ALLOWED_HOSTS at runtime',
  },
  {
    key: ['projects', 'app', 'architect', 'serve', 'options'],
    kind: 'extra',
    path: 'angular.json',
    reason: 'port 3001 (backend contract), dev proxy (`proxy.conf.mjs`), `*.localhost` for `lt dev` behind Caddy',
  },
  {
    key: ['projects', 'app', 'architect', 'test', 'options'],
    kind: 'extra',
    path: 'angular.json',
    reason: 'spec tsconfig, include pattern and the jsdom setup file (`src/test-setup.ts`)',
  },
  // ── package.json ───────────────────────────────────────────────────────────────────────────────────────────────
  { key: ['name'], kind: 'value', path: 'package.json', reason: 'repository package name (the lt CLI renames it to `app`)' },
  { key: ['version'], kind: 'value', path: 'package.json', reason: 'release version of the starter (22.x follows the Angular major)' },
  { key: ['packageManager'], kind: 'value', path: 'package.json', reason: 'exact pnpm pin with integrity hash, identical to nuxt-base-starter' },
  { key: ['scripts', '**'], kind: 'value', path: 'package.json', reason: 'lt-monorepo script contract (plan §5.4): dev/start/build/test/check/... instead of the CLI defaults' },
  { key: ['scripts', '**'], kind: 'extra', path: 'package.json', reason: 'lt-monorepo script contract (plan §5.4)' },
  { key: ['devDependencies', 'prettier'], kind: 'value', path: 'package.json', reason: 'oxfmt instead of prettier (plan §5.4)' },
  { key: ['devDependencies', '@types/node'], kind: 'value', path: 'package.json', reason: 'Node 26 types (`.node-version` 26), same as nuxt-base-starter' },
  { key: ['dependencies', '*'], kind: 'extra', path: 'package.json', reason: 'lt stack runtime dependencies (ng-base and its peers), all exact pins' },
  { key: ['devDependencies', '*'], kind: 'extra', path: 'package.json', reason: 'lt stack tooling (oxlint, oxfmt, angular-eslint, Playwright, hey-api, ...), all exact pins' },
  { key: ['*'], kind: 'extra', path: 'package.json', reason: 'repository metadata, `type: module`, engines, git hooks (simple-git-hooks, lint-staged)' },
  // ── tsconfig ───────────────────────────────────────────────────────────────────────────────────────────────────
  { key: ['exclude'], kind: 'value', path: 'tsconfig.app.json', reason: 'the spec setup file is no app code' },
  { key: ['include'], kind: 'value', path: 'tsconfig.spec.json', reason: 'adds the spec setup file' },
  { key: ['compilerOptions', 'types'], kind: 'value', path: 'tsconfig.spec.json', reason: 'Node types for specs that use Node APIs (`node:vm` in the reset-link script spec)' },
];

/** Dependencies whose versions are compared: an exact pin here must satisfy the CLI's range. */
const DEPENDENCY_KEYS = ['dependencies', 'devDependencies'];

// ── pure helpers (unit-tested) ───────────────────────────────────────────────────────────────────────────────────

/** Whether `version` (exact `x.y.z`) satisfies an npm range of the shapes the CLI writes: `^x.y.z`, `~x.y.z`, `x.y.z`. */
export function satisfiesCliRange(version, range) {
  const parse = (v) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const actual = parse(version);
  const operator = /^[\^~]/.exec(range)?.[0] ?? '';
  const wanted = parse(range.slice(operator.length));
  if (!actual || !wanted) return false;
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (cmp(actual, wanted) < 0) return false;
  if (operator === '^') return wanted[0] === 0 ? actual[0] === 0 && actual[1] === wanted[1] : actual[0] === wanted[0];
  if (operator === '~') return actual[0] === wanted[0] && actual[1] === wanted[1];
  return cmp(actual, wanted) === 0;
}

/** Whether a key path matches a pattern (both arrays of segments; `*` one segment, trailing `**` the rest). */
export function keyMatches(p, k) {
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '**') return i === p.length - 1;
    if (i >= k.length || (p[i] !== '*' && p[i] !== k[i])) return false;
  }
  return p.length === k.length;
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The key-level differences between the reference JSON and ours: `value` for a key whose value differs or that is
 * missing here, `extra` for a key only we have. Objects are walked; arrays and scalars compare as a whole. For
 * dependency maps, an exact pin that satisfies the CLI's range is no difference.
 */
export function diffJson(reference, actual, prefix = []) {
  const out = [];
  for (const [name, refValue] of Object.entries(reference)) {
    const key = [...prefix, name];
    if (!(name in actual)) {
      out.push({ key, kind: 'value' });
      continue;
    }
    const value = actual[name];
    if (isObject(refValue) && isObject(value)) {
      out.push(...diffJson(refValue, value, key));
      continue;
    }
    const isDependency = prefix.length === 1 && DEPENDENCY_KEYS.includes(prefix[0]) && typeof refValue === 'string' && typeof value === 'string';
    if (isDependency ? !satisfiesCliRange(value, refValue) : JSON.stringify(refValue) !== JSON.stringify(value)) {
      out.push({ key, kind: 'value' });
    }
  }
  for (const name of Object.keys(actual)) {
    if (!(name in reference)) out.push({ key: [...prefix, name], kind: 'extra' });
  }
  return out;
}

/** Strips `/* … *\/` and `// …` comments (the CLI writes JSONC tsconfigs) and trailing commas, then parses. */
export function parseJsonc(text) {
  let out = '';
  for (let i = 0, inString = false; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      if (i === 0) break;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Matches every difference against the allowlist; returns the unexplained ones and the stale allowances. */
export function judge(differences, allowed = ALLOWED) {
  const used = new Set();
  const unexplained = [];
  for (const difference of differences) {
    const index = allowed.findIndex(
      (entry) =>
        entry.path === difference.path &&
        entry.kind === difference.kind &&
        (difference.key === undefined ? entry.key === undefined : entry.key !== undefined && keyMatches(entry.key, difference.key)),
    );
    if (index === -1) unexplained.push(difference);
    else used.add(index);
  }
  const stale = allowed.filter((_, index) => !used.has(index));
  return { stale, unexplained };
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────────────────

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
}

function generateReference(cliVersion) {
  const scratch = mkdtempSync(join(tmpdir(), 'ng-baseline-'));
  const result = run('npx', ['--yes', `@angular/cli@${cliVersion}`, ...NG_NEW_ARGS], scratch);
  if (result.status !== 0) {
    rmSync(scratch, { force: true, recursive: true });
    throw new Error(`ng new failed (exit ${result.status}):\n${result.stderr || result.stdout}`);
  }
  const reference = join(scratch, 'app');
  // Format the reference with this repo's style; both trees then differ only in content.
  cpSync(join(ROOT, '.oxfmtrc.jsonc'), join(reference, '.oxfmtrc.jsonc'));
  run(process.execPath, [join(ROOT, 'node_modules', 'oxfmt', 'bin', 'oxfmt')], reference);
  rmSync(join(reference, '.oxfmtrc.jsonc'));
  return { reference, scratch };
}

function compareTrees(reference) {
  const differences = [];
  for (const file of listFiles(reference)) {
    const ours = join(ROOT, file);
    if (!existsSync(ours)) {
      differences.push({ kind: 'absent', path: file });
      continue;
    }
    const refText = readFileSync(join(reference, file), 'utf8');
    const ourText = readFileSync(ours, 'utf8');
    if (file.endsWith('.json')) {
      for (const d of diffJson(parseJsonc(refText), parseJsonc(ourText))) differences.push({ ...d, path: file });
    } else if (refText !== ourText) {
      differences.push({ kind: 'content', path: file });
    }
  }
  return differences;
}

function main() {
  const cliVersion = JSON.parse(readFileSync(join(ROOT, 'node_modules', '@angular', 'cli', 'package.json'), 'utf8')).version;
  console.log(`check:baseline: comparing with \`ng new\` of @angular/cli ${cliVersion}`);
  let generated;
  try {
    generated = generateReference(cliVersion);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(2);
  }
  try {
    const { stale, unexplained } = judge(compareTrees(generated.reference));
    for (const d of unexplained) console.error(`  ✗ ${d.path}${d.key ? ` → ${d.key.join(' › ')}` : ''} (${d.kind}): deviates from the CLI baseline without a listed reason`);
    for (const a of stale) console.error(`  ✗ stale allowance: ${a.path}${a.key ? ` → ${a.key.join(' › ')}` : ''} (${a.kind}) no longer deviates; remove it`);
    if (unexplained.length || stale.length) {
      console.error(`check:baseline: FAILED (${unexplained.length} unexplained, ${stale.length} stale)`);
      process.exit(1);
    }
    console.log(`check:baseline: OK (${ALLOWED.length} allowed deviations, each with a reason)`);
  } finally {
    rmSync(generated.scratch, { force: true, recursive: true });
  }
}

function isCliEntry() {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main();
}
