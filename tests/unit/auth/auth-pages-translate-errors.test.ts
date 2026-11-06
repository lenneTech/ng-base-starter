/**
 * Every auth page runs backend errors through the error translation (rule A.9.1 of the Nuxt template).
 *
 * A structural test, because a page that skips translation looks exactly like one that does, right up until an error
 * occurs in production. nest-server wraps failed `/iam/*` responses so their message carries `#LTNS_…`: a page that
 * prints `error.message` unfiltered shows the raw marker, which reads like a system fault. Measured in two projects on
 * the Nuxt template: the recovery pages (forgot/reset password, verify e-mail, 2FA) were the ones that skipped it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AUTH_DIR, authPages, pageCode } from './auth-page-sources';

/**
 * The account security settings (2FA, backup codes, passkeys) talk to the same `/iam/*` endpoints and show their
 * errors to the same users, so they follow the same rule.
 */
const SETTINGS_SOURCES: readonly string[] = ['security-page', 'backup-codes-dialog'];

function settingsCode(name: string): string {
  return readFileSync(join(AUTH_DIR, '..', 'settings', `${name}.ts`), 'utf8');
}

/** Pages that legitimately never surface a backend error. Empty on purpose; an entry needs a written reason. */
const EXEMPT: readonly string[] = [];

describe('auth pages route errors through translateError', () => {
  it('finds the auth pages at all', () => {
    expect(authPages().length).toBeGreaterThanOrEqual(7);
  });

  it.each(authPages().filter((page) => !EXEMPT.includes(page)))('%s translates backend errors', (page) => {
    const source = pageCode(page);
    expect(source, `${page} does not inject LtErrorTranslationService.`).toContain('LtErrorTranslationService');
    expect(source, `${page} never calls translateError.`).toContain('translateError(');
  });

  it.each(authPages())('%s does not display a raw error message', (page) => {
    expect(pageCode(page), `${page} shows a raw error message. Wrap it in translateError first.`).not.toMatch(/description:\s*[\w.?]*error\??\.message(?!\s*[?\w])/);
  });

  it.each(authPages())('%s never writes `translateError(x) || fallback`', (page) => {
    // Unreachable: translateError returns its input when it cannot translate, so only an empty input yields ''.
    expect(pageCode(page)).not.toMatch(/translateError\([^)]*\)\s*\|\|/);
  });
});

describe('security settings route errors through translateError', () => {
  it.each(SETTINGS_SOURCES)('%s translates backend errors', (name) => {
    const source = settingsCode(name);
    expect(source, `${name} does not inject LtErrorTranslationService.`).toContain('LtErrorTranslationService');
    expect(source, `${name} never calls translateError.`).toContain('translateError(');
  });

  it.each(SETTINGS_SOURCES)('%s does not display a raw error message', (name) => {
    expect(settingsCode(name), `${name} shows a raw error message ("#LTNS_0002: Invalid password").`).not.toMatch(/description:\s*[\w.?]*error\??\.message(?!\s*[?\w])/);
  });
});
