/**
 * No page puts an e-mail address into a URL it navigates to. In the address bar it went to analytics, the referrer,
 * the browser history and every pasted link; login and sign-up hand it over in the history entry instead
 * (`verifyEmailState`, `src/app/auth/verify-email-memory.ts`). The flow itself is `tests/e2e/auth-verify-email-url.spec.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const APP_DIR = join(import.meta.dirname, '..', '..', '..', 'src', 'app');

const sources = readdirSync(APP_DIR, { recursive: true })
  .map(String)
  .filter((file) => /\.(ts|html)$/.test(file) && !file.endsWith('.spec.ts'));

/** A `queryParams: { … }` literal (TS or template) that names an e-mail field. */
const ADDRESS_IN_QUERY = /queryParams\]?=?["']?\s*:?\s*\{[^}]*\bemail\b\s*:/;

it('finds the sources it checks', () => {
  expect(sources.length).toBeGreaterThan(10);
});

it.each(sources)('%s puts no e-mail address into a query', (file) => {
  const text = readFileSync(join(APP_DIR, file), 'utf8');
  // `email: null` removes the parameter from the URL (verify-email-page moves it into the history entry): allowed.
  expect(text.replace(/\bemail:\s*null\b/g, '')).not.toMatch(ADDRESS_IN_QUERY);
});
