import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every explicit sign-out sets the "signed out" mark of the silent sign-in (`src/app/auth/social-sign-in-marks.ts`),
 * before it signs out (Nuxt template: "every sign-out sets the "signed out" mark" in
 * `tests/unit/utils/social-sign-in.test.ts`).
 *
 * A sign-out without the mark lets the silent attempt sign the visitor straight back in, in this tab or any other,
 * because the provider session outlives the app's. New call sites have to set it too; this test finds them.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..');
const APP_DIR = join(ROOT, 'src', 'app');

/** Source without comments, so a comment that mentions a call does not count. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * A path relative to the repository root with `/` as separator. On Windows `relative()` answers with backslashes, and
 * the CI job there runs these tests too (`.github/workflows/test.yml`, job `windows`); found by the Nuxt template's
 * review of the same test.
 */
function repoPath(file: string): string {
  return relative(ROOT, file).replaceAll('\\', '/');
}

// `src/app/` only: a vendored ng-base core lives in `src/core/` and needs no filter here.
const callers = readdirSync(APP_DIR, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
  .map((file) => join(APP_DIR, file))
  .filter((file) => /\.signOut\(/.test(code(file)));

describe('every sign-out sets the "signed out" mark', () => {
  it('finds the sign-out call sites', () => {
    expect(callers.map(repoPath).sort()).toEqual(expect.arrayContaining(['src/app/dashboard/dashboard-page.ts', 'src/app/layout/default-layout.ts']));
  });

  it('writes the repository paths with forward slashes, also from Windows separators', () => {
    expect(repoPath(join(ROOT, 'src', 'app', 'layout', 'default-layout.ts'))).toBe('src/app/layout/default-layout.ts');
    expect('src\\app\\layout\\default-layout.ts'.replaceAll('\\', '/')).toBe('src/app/layout/default-layout.ts');
  });

  it.each(callers.map(repoPath))('%s sets the mark before each sign-out', (file) => {
    const source = code(join(ROOT, file));
    for (const call of source.matchAll(/\.signOut\(/g)) {
      const before = source.slice(Math.max(0, (call.index ?? 0) - 400), call.index);
      expect(before, `${file}: no markSignedOut() before the sign-out at offset ${call.index}`).toMatch(/\.markSignedOut\(\)/);
    }
  });
});
