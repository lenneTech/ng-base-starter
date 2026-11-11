// @vitest-environment node
/**
 * The generated API client is not linted as project code (port of the Nuxt template's
 * `tests/unit/oxlint-generated-client.test.ts`, nuxt-base-starter 6e70a8f).
 *
 * `pnpm run generate-types` writes `src/api-client/` from the API's OpenAPI document (openapi-ts.config.ts).
 * What the generator emits is its business: a finding there can only be fixed in the generator, and a hand
 * fix is gone after the next run. With @hey-api/openapi-ts 0.97+ a Nuxt project got about 170 warnings and one
 * `typescript/no-floating-promises` error from `lint` in generated files, so the pre-commit hook and the CI lint
 * job failed on code nobody in the project wrote (found in a project comparing its config with the Nuxt template,
 * 2026-11-10). `.oxlintrc.json` therefore ignores `src/api-client/**`, as `eslint.config.js` already did. Type
 * checking and formatting still cover it: `typecheck` reads the generated types the app imports, and the
 * generator's own `postProcess` runs oxfmt on the output.
 *
 * Checked by running oxlint, both ways a project runs it: over `src/` (`lint`, CI) and on single staged files
 * (`lint-staged` passes each path explicitly). This repository commits no generated client, so its own lint
 * would never show the difference.
 *
 * Ignoring the folder has two callers to keep in step, because oxlint exits 1 ("No files found to lint") when
 * every path it is given is ignored:
 * - the generator's `postProcess` must not run oxlint on its output any more, or every `generate-types` run
 *   fails and the oxfmt step after it never formats the client;
 * - the lint-staged command for `src/**\/*.ts` needs `--no-error-on-unmatched-pattern`, or a commit that stages
 *   only a regenerated client is refused.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');

/** Findings of rules every project file is linted with: `eqeqeq` and `unicorn(no-useless-spread)`. */
const PROBE = 'export const same = (a: unknown, b: unknown): boolean => a == b;\nexport const copy = [...[1, 2]];\n';
const FILES = ['src/api-client/sdk.gen.ts', 'src/api-client/client/utils.gen.ts', 'src/app/shared/project.ts'];

/** Runs oxlint with this project's `.oxlintrc.json` on the probes: the files it reported, sorted, and its exit code. */
function lintRun(args: string[]): { reported: string[]; status: null | number } {
  const dir = mkdtempSync(join(tmpdir(), 'oxlint-api-client-'));
  try {
    copyFileSync(join(ROOT, '.oxlintrc.json'), join(dir, '.oxlintrc.json'));
    for (const file of FILES) {
      mkdirSync(join(dir, dirname(file)), { recursive: true });
      writeFileSync(join(dir, file), PROBE);
    }
    const oxlint = join(dirname(createRequire(import.meta.url).resolve('oxlint/package.json')), 'bin', 'oxlint');
    // TERMINAL_EMULATOR left out: in a JetBrains terminal oxlint prints `file:///` URLs instead of paths.
    const env = { ...process.env, TERMINAL_EMULATOR: undefined };
    const run = spawnSync(process.execPath, [oxlint, '-f', 'unix', ...args], { cwd: dir, encoding: 'utf8', env, timeout: 20_000 });
    expect(run.error).toBeUndefined();
    const reported = run.stdout
      .split('\n')
      .map((line) => /(src[/\\][\w./\\-]+?):\d+:\d+: /.exec(line)?.[1]?.replaceAll('\\', '/'))
      .filter((file): file is string => file !== undefined);
    return { reported: [...new Set(reported)].sort((a, b) => a.localeCompare(b)), status: run.status };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

const lint = (args: string[]): string[] => lintRun(args).reported;

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { 'lint-staged': Record<string, string[]> };

/** The oxlint arguments lint-staged runs for staged src files, without the type-aware pass (it needs a tsconfig). */
function lintStagedArgs(): string[] {
  const command = pkg['lint-staged']['src/**/*.ts']?.find((step) => step.startsWith('oxlint'));
  expect(command, 'lint-staged runs oxlint on src/**/*.ts').toBeDefined();
  return (command ?? '')
    .split(/\s+/)
    .slice(1)
    .filter((arg) => arg !== '--type-aware');
}

/** `defineConfig` may return a promise; the config refuses to load without `NG_API_URL` (DEV-2802), any URL will do. */
async function openApiOutput(): Promise<{ path?: string; postProcess?: unknown[] }> {
  process.env['NG_API_URL'] ||= 'http://127.0.0.1:1';
  const config = (await (await import('../../openapi-ts.config')).default) as { output: { path?: string; postProcess?: unknown[] } };
  return config.output;
}

describe('oxlint vs. the generated API client', () => {
  it('lints src/ without src/api-client/ (lint, CI)', () => {
    expect(lint(['src/'])).toEqual(['src/app/shared/project.ts']);
  });

  it('skips a generated file passed by name (lint-staged), and still lints project files passed the same way', () => {
    expect(lint(FILES)).toEqual(['src/app/shared/project.ts']);
  });

  it('lets a commit through that stages only the regenerated client (lint-staged command, exit 0)', () => {
    const run = lintRun([...lintStagedArgs(), 'src/api-client/sdk.gen.ts', 'src/api-client/client/utils.gen.ts']);
    expect(run.reported).toEqual([]);
    expect(run.status, 'oxlint exits 1 when every staged path is ignored: lint-staged needs --no-error-on-unmatched-pattern').toBe(0);
  });

  // oxfmt is the one post-processor left, so it must not ignore the client: on a path it ignores it exits 2
  // ("Expected at least one target file"), which failed every generate-types run and every commit staging only
  // the client. The Nuxt template formats its client the same way; `format:check` then covers it too.
  it('formats the generated client with oxfmt (postProcess, lint-staged) instead of ignoring it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxfmt-api-client-'));
    try {
      copyFileSync(join(ROOT, '.oxfmtrc.jsonc'), join(dir, '.oxfmtrc.jsonc'));
      mkdirSync(join(dir, 'src/api-client'), { recursive: true });
      writeFileSync(join(dir, 'src/api-client/sdk.gen.ts'), 'export const   x =   1\n');
      const oxfmt = join(dirname(createRequire(import.meta.url).resolve('oxfmt/package.json')), 'bin', 'oxfmt');
      const run = spawnSync(process.execPath, [oxfmt, 'src/api-client'], { cwd: dir, encoding: 'utf8', timeout: 20_000 });
      expect(run.error).toBeUndefined();
      expect(run.status, `oxfmt must format src/api-client: ${run.stderr || run.stdout}`).toBe(0);
      expect(readFileSync(join(dir, 'src/api-client/sdk.gen.ts'), 'utf8')).toBe('export const x = 1;\n');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('writes the client where oxlint ignores it, and does not run oxlint on it after generating', async () => {
    const output = await openApiOutput();
    expect(output.path).toBe('./src/api-client');
    // oxlint on an output path it ignores exits 1, which fails every generate-types run before oxfmt formats it.
    expect(output.postProcess).toEqual(['oxfmt']);
  });
});
