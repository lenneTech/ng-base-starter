import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The social sign-in stays out of the initial bundle. `app.routes.ts` and the guards it imports are loaded by every
 * visitor; the provider list, the marks and the German texts for `?error=` belong to the lazy auth pages and layouts.
 * Measured while `sign-in-error-text-guard.ts` imported its helper from `social-sign-in-error.ts`: every text of that
 * file was in `main-*.js`.
 */
const AUTH_DIR = join(import.meta.dirname, '..', '..', '..', 'src', 'app', 'auth');
const EAGER = ['../app.routes.ts', 'guest-guard.ts', 'sign-in-error-text-guard.ts'];
const LAZY_ONLY = /from '\.\/(?:auth\/)?social-(?:providers|sign-in-error|sign-in-marks)'/;

describe('social sign-in and the initial bundle', () => {
  it.each(EAGER)('%s imports none of the social sign-in modules', (file) => {
    expect(readFileSync(join(AUTH_DIR, file), 'utf8')).not.toMatch(LAZY_ONLY);
  });
});
