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

/**
 * The text without the two blocks the lt CLI writes into a generated project:
 *
 * - the vendor notice at the start of the file in vendor mode (`<!-- lt-vendor-marker-frontend -->` up to the first
 *   `---` and the blank line after it; the CLI's own pattern, anchored at the file start),
 * - the URL block of `lt dev` (`<!-- lt-dev:url-block:start -->` … `<!-- lt-dev:url-block:end -->`, with its surrounding
 *   blank lines).
 *
 * lt CLI 1.57.0 writes both into CLAUDE.md only, from 1.57.1 into both files; either way the rest has to be the same.
 */
function withoutLtManagedBlocks(text: string): string {
  return (
    text
      .replace(/^<!-- lt-vendor-marker-frontend -->[\s\S]*?---\s*\n?/, '')
      .replace(/\n*<!-- lt-dev:url-block:start -->[\s\S]*?<!-- lt-dev:url-block:end -->\n*/g, '\n')
      // trimEnd: Markdown ends without a final newline here; a block appended at the end leaves one behind.
      .trimEnd()
  );
}

describe('agent docs', () => {
  const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');

  it('CLAUDE.md and AGENTS.md carry the same text (apart from the blocks the lt CLI writes)', () => {
    expect(withoutLtManagedBlocks(claude)).toBe(withoutLtManagedBlocks(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')));
  });

  it('tolerates the URL block of `lt dev` in one file only, and nothing else (self-test)', () => {
    const block = '<!-- lt-dev:url-block:start -->\n## Local URLs\n\n- App: https://x.localhost\n<!-- lt-dev:url-block:end -->';
    const text = '# Title\n\nRules.\n';
    expect(withoutLtManagedBlocks(`${text}\n${block}\n`)).toBe(withoutLtManagedBlocks(text));
    // As lt CLI 1.57.0 does it: appended to a file that ends without a newline.
    expect(withoutLtManagedBlocks(`# Title\n\nRules.\n\n${block}\n`)).toBe(withoutLtManagedBlocks('# Title\n\nRules.'));
    expect(withoutLtManagedBlocks(`${text}\n${block}\n`)).not.toBe(withoutLtManagedBlocks('# Title\n\nOther rules.\n'));
  });

  it('tolerates the vendor notice of the lt CLI at the file start, and nowhere else (self-test)', () => {
    // As lt CLI 1.57.0 writes it in vendor mode (`lt fullstack init --frontend-framework-mode vendor`).
    const notice = '<!-- lt-vendor-marker-frontend -->\n\n# Vendor-Mode Notice (Frontend)\n\nThis frontend project runs in **vendor mode** — read `src/core/**`.\n\n---\n\n';
    const text = '> Source of the following rules: …\n\n# Title\n\nRules.';
    expect(withoutLtManagedBlocks(`${notice}${text}`)).toBe(text);
    // Together with the URL block, as in a vendor-mode project under `lt dev`.
    const urlBlock = '<!-- lt-dev:url-block:start -->\n- App: https://x.localhost\n<!-- lt-dev:url-block:end -->';
    expect(withoutLtManagedBlocks(`${notice}${text}\n\n${urlBlock}\n`)).toBe(text);
    // Only at the file start: the same text further down is content and stays.
    expect(withoutLtManagedBlocks(`${text}\n\n${notice}`)).not.toBe(text);
    expect(withoutLtManagedBlocks(`${notice}${text}`)).not.toBe(text.replace('Rules', 'Other rules'));
  });

  it('start with the source line and the Angular CLI rules file verbatim, followed by the stack section', () => {
    const source = `> Source of the following rules: Angular CLI ${cliVersion()}, \`ng new --ai-config=claude-code\``;
    const [firstLine = '', ...rest] = withoutLtManagedBlocks(claude).split('\n');
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
