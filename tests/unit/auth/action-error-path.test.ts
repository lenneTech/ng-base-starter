/**
 * Every user action on the auth and security pages ends with feedback, also when the request never gets an answer.
 *
 * The auth client answers a refused request with `{ error }`, but a request that fails on the way (API down, CORS,
 * offline) rejects with `TypeError: Failed to fetch`. An action written as `try { … } finally { loading = false }`
 * then shows nothing at all: the button comes back, no toast, no notice, and the user presses it again. Auth rule 2
 * (CLAUDE.md) wants "try later" for 429, 5xx and network errors, so every `try` of these pages needs a `catch` that
 * says so. Found against an API in JWT mode, whose wildcard CORS the browser refuses for credentialed requests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AUTH_DIR, authPages, pageCode } from './auth-page-sources';

const SETTINGS_DIR = join(AUTH_DIR, '..', 'settings');

/** The auth pages plus the security settings, where 2FA, backup codes and passkeys are managed. */
function sources(): { code: string; file: string }[] {
  const auth = authPages().map((page) => ({ code: pageCode(page), file: `src/app/auth/${page}.ts` }));
  const settings = ['security-page', 'backup-codes-dialog'].map((name) => ({
    code: readFileSync(join(SETTINGS_DIR, `${name}.ts`), 'utf8'),
    file: `src/app/settings/${name}.ts`,
  }));
  return [...auth, ...settings];
}

/** The `try` blocks that reach their `finally` without a `catch` in between, by line number. */
function tryWithoutCatch(code: string): number[] {
  const lines: number[] = [];
  for (const match of code.matchAll(/\btry \{/g)) {
    const rest = code.slice(match.index);
    const end = rest.search(/\} finally \{/);
    const catchAt = rest.search(/\} catch\b/);
    if (end !== -1 && (catchAt === -1 || catchAt > end)) {
      lines.push(code.slice(0, match.index).split('\n').length);
    }
  }
  return lines;
}

describe('auth and security page actions', () => {
  it('give feedback when the request fails on the way (every try has a catch before its finally)', () => {
    const missing = Object.fromEntries(
      sources()
        .map(({ code, file }) => [file, tryWithoutCatch(code)] as const)
        .filter(([, lines]) => lines.length > 0),
    );
    expect(missing, 'add a catch that shows "Bitte versuche es später erneut." (auth rule 2)').toEqual({});
  });

  it('recognises a try that only has a finally (self-test)', () => {
    expect(tryWithoutCatch('try {\n  await x();\n} finally {\n  done();\n}')).toEqual([1]);
    expect(tryWithoutCatch('try {\n  await x();\n} catch {\n  show();\n} finally {\n  done();\n}')).toEqual([]);
  });
});
