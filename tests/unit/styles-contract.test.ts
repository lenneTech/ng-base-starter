/**
 * `src/styles.css` imports ng-base's `core.css` plus one file per component the app renders (the full `theme.css`
 * would cost about 200 kB raw CSS). A component used in a template without its CSS renders unstyled, which no build
 * or type check notices. This test closes that gap: every Helm or lt selector used in a template of `src/app` must
 * be covered by the component files `styles.css` pulls in, directly or through their own imports.
 *
 * A selector counts as covered when an imported file names it in its `@source inline(...)` list (`hlmBtn` sits in
 * `button.css`), or when the file named after it is imported (`hlmDropdownMenuItem` → `dropdown-menu.css`,
 * `<hlm-separator>` → `separator.css`).
 */
import tailwind from '@tailwindcss/postcss';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const STYLES = join(ROOT, 'src/styles.css');
const VENDORED = existsSync(join(ROOT, 'src/core/VENDOR.md'));
const NG_BASE_STYLES = VENDORED ? join(ROOT, 'src/core/ui/styles') : join(ROOT, 'node_modules/@lenne.tech/ng-base/ui/styles');
const COMPONENTS = join(NG_BASE_STYLES, 'components');

/** Every `.html` template below `dir`. */
function templates(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Helm and lt selectors of a template: `<hlm-x>`/`<lt-x>` elements and `hlmX`/`ltX` attribute directives. */
function selectorsOf(template: string): string[] {
  return [...template.matchAll(/<((?:hlm|lt)-[a-z-]+)|\b((?:hlm|lt)[A-Z][A-Za-z]*)\b/g)].map((match) => match[1] ?? match[2] ?? '');
}

/** The ng-base CSS file an `@import` of `src/styles.css` points to, or null for anything else (Tailwind, plugins). */
function resolveAppImport(specifier: string): null | string {
  if (specifier.startsWith('@lenne.tech/ng-base/')) {
    return join(NG_BASE_STYLES, '..', '..', specifier.slice('@lenne.tech/ng-base/'.length));
  }
  if (specifier.startsWith('./core/')) {
    return join(ROOT, 'src', specifier);
  }
  return null;
}

/** All ng-base CSS files reachable from `src/styles.css`, following the relative `@import`s inside ng-base. */
function importedFiles(): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file) || !existsSync(file)) {
      return;
    }
    seen.add(file);
    for (const [, specifier = ''] of readFileSync(file, 'utf8').matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        visit(resolve(dirname(file), specifier));
      }
    }
  };
  for (const [, specifier = ''] of readFileSync(STYLES, 'utf8').matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    const file = resolveAppImport(specifier);
    if (file) {
      visit(file);
    }
  }
  return seen;
}

/** The tokens of a component file's `@source inline(...)`, brackets and parentheses removed. */
function sourceTokens(file: string): Set<string> {
  return new Set(rawSourceTokens(file).map((token) => token.replace(/^[[(]+|[\])]+$/g, '')));
}

/** The words of a component file's `@source inline(...)` exactly as Tailwind reads them. */
function rawSourceTokens(file: string): string[] {
  const inline = [...readFileSync(file, 'utf8').matchAll(/@source inline\("([^"]*)"\)/g)].map((match) => match[1]).join(' ');
  return inline.split(/\s+/).filter(Boolean);
}

/** `hlmDropdownMenuItem` → `dropdown-menu-item`, `lt-page-card` → `lt-page-card`, `ltPageCardFooter` → `lt-page-card-footer`. */
function kebabName(selector: string): string {
  const kebab = selector.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  return kebab.startsWith('hlm-') ? kebab.slice('hlm-'.length) : kebab;
}

/** Whether `selector` is covered by one of the imported component files. */
function isCovered(selector: string, imported: Set<string>): boolean {
  const componentFiles = [...imported].filter((file) => dirname(file) === COMPONENTS);
  if (componentFiles.some((file) => sourceTokens(file).has(selector))) {
    return true;
  }
  const parts = kebabName(selector).split('-');
  for (let length = parts.length; length > 0; length--) {
    const candidate = join(COMPONENTS, `${parts.slice(0, length).join('-')}.css`);
    if (existsSync(candidate)) {
      return imported.has(candidate);
    }
  }
  return false;
}

describe('src/styles.css', () => {
  it('finds the ng-base styles it builds on', () => {
    expect(existsSync(join(NG_BASE_STYLES, 'core.css')), relative(ROOT, NG_BASE_STYLES)).toBe(true);
    expect(existsSync(COMPONENTS), relative(ROOT, COMPONENTS)).toBe(true);
  });

  it('limits the Tailwind class scanner to src/', () => {
    expect(readFileSync(STYLES, 'utf8')).toMatch(/@import\s+'tailwindcss'\s+source\('\.'\);/);
  });

  it('imports the CSS of every Helm and lt component a template uses', () => {
    const imported = importedFiles();
    const missing = new Map<string, string[]>();
    for (const file of templates(join(ROOT, 'src/app'))) {
      for (const selector of selectorsOf(readFileSync(file, 'utf8'))) {
        if (!isCovered(selector, imported)) {
          missing.set(selector, [...(missing.get(selector) ?? []), relative(ROOT, file)]);
        }
      }
    }
    expect(Object.fromEntries(missing), 'add the matching components/<name>.css import to src/styles.css').toEqual({});
  });

  it('catches a missing import (self-test of the coverage rule)', () => {
    const onlyCore = new Set([join(NG_BASE_STYLES, 'core.css'), join(COMPONENTS, 'card.css')]);
    expect(isCovered('hlmCardTitle', onlyCore)).toBe(true);
    expect(isCovered('hlmBtn', onlyCore)).toBe(false);
    expect(isCovered('hlm-separator', onlyCore)).toBe(false);
  });

  it('hands Tailwind only class lists it can read (balanced brackets in every imported @source inline)', () => {
    // Tailwind drops a whole `@source inline(...)` list at one unbalanced `(` or `[`: one stray word from a comment
    // ("(the") once cost every dialog class, and tall dialogs could no longer scroll to their buttons.
    const unbalanced = [...importedFiles()]
      .filter((file) => dirname(file) === COMPONENTS)
      .flatMap((file) =>
        rawSourceTokens(file)
          .filter((token) => count(token, '(') !== count(token, ')') || count(token, '[') !== count(token, ']'))
          .map((token) => `${relative(COMPONENTS, file)}: ${token}`),
      );
    expect(unbalanced, 'ng-base generates these files (scripts/generate-ui-sources.mjs); fix it there').toEqual([]);
  });

  it('compiles to the classes the dialogs need to fit the screen', { timeout: 60_000 }, async () => {
    const { css } = await postcss([tailwind()]).process(readFileSync(STYLES, 'utf8'), { from: STYLES });
    // ng-base's overlay default (`LT_OVERLAY_CONTENT_CLASS`) and the dialog frame.
    for (const selector of ['.max-h-\\[calc\\(100dvh-2rem\\)\\]', '.overflow-y-auto', '.w-\\[calc\\(100vw-2rem\\)\\]']) {
      expect(css, selector).toContain(selector);
    }
  });
});

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}
