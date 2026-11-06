/**
 * The agent docs: `CLAUDE.md` (Claude Code) and `AGENTS.md` (Codex and other agents).
 *
 * - Both carry the same text. Two files that drift give two agents two different rule sets for one repository.
 * - Both start with the Angular CLI's own rules file VERBATIM, the one `ng new --ai-config` writes for the pinned
 *   CLI version (Kai, 2026-11-06: the starter looks exactly like a fresh `ng new` and follows the official best
 *   practices word for word). The lenne.Tech rules follow in a section of their own. After an `ng update` that
 *   changes the CLI's rules file, this test fails until the block is replaced.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);

/** The pinned Angular CLI version. */
function cliVersion(): string {
  return (JSON.parse(readFileSync(require.resolve('@angular/cli/package.json', { paths: [ROOT] }), 'utf8')) as { version: string }).version;
}

/** The rules template of the @schematics/angular version the pinned @angular/cli uses. */
function cliRulesTemplate(): string {
  const cliPackage = require.resolve('@angular/cli/package.json', { paths: [ROOT] });
  const schematics = dirname(require.resolve('@schematics/angular/package.json', { paths: [dirname(cliPackage)] }));
  return readFileSync(join(schematics, 'ai-config', 'files', '__bestPracticesName__.template'), 'utf8');
}

describe('agent docs', () => {
  const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');

  it('CLAUDE.md and AGENTS.md are identical', () => {
    expect(claude).toBe(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'));
  });

  it('start with the source line and the Angular CLI rules file verbatim, followed by the stack section', () => {
    const source = `> Source of the following rules: Angular CLI ${cliVersion()}, \`ng new --ai-config=claude-code\``;
    const [firstLine = '', ...rest] = claude.split('\n');
    expect(firstLine.startsWith(source)).toBe(true);
    expect(firstLine).toContain('© Google LLC, MIT License');
    const template = cliRulesTemplate().trimEnd();
    expect(rest.join('\n').startsWith(`\n${template}\n\n---\n\n# ng-base-starter\n`)).toBe(true);
  });

  it('name the ports, the runtime config and the vendor-mode detection', () => {
    for (const needle of ['3000', '3001', 'NG_PUBLIC_SITE_URL', 'src/core/VENDOR.md', 'pnpm run check']) {
      expect(claude, needle).toContain(needle);
    }
  });
});
