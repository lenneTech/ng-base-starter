/**
 * Contract test for the `?redirect=` validator.
 *
 * This guards a security control, so the table below is the specification: every row
 * is a shape the value can actually arrive in, and the expectation says whether it
 * reaches the router or is replaced by the fallback.
 *
 * The control-character rows are the reason this file exists. The original inline
 * version used `/^\/(?![/\\])/` alone, which inspects a single character and
 * therefore passed `/<TAB>/evil.com`. That string is stripped to `//evil.com` by the
 * WHATWG URL parser, so the Nuxt router classified it as external and threw — leaving a
 * user who had just signed in successfully looking at "Ein unerwarteter Fehler ist
 * aufgetreten" on the login page. The throw was doing the security work; this
 * function is what makes the fallback silent and correct instead.
 */
import { describe, expect, it } from 'vitest';

import { safeRedirectTarget } from './safe-redirect-target';

describe('safeRedirectTarget', () => {
  describe('accepts same-origin absolute paths', () => {
    it.each([
      ['bare app root', '/app'],
      ['bare slash', '/'],
      ['nested path', '/app/records/42'],
      ['path with query', '/app/records/42?tab=x'],
      ['path with query and hash', '/app/records/42?tab=x#section'],
      ['path with encoded space', '/app/my%20record'],
      // The router resolves %2f as a literal path segment, so this stays
      // same-origin — a 404, not a redirect. Pinned so the call stays deliberate.
      ['percent-encoded slashes', '/%2f%2fevil.com'],
    ])('%s', (_label, input) => {
      expect(safeRedirectTarget(input)).toBe(input);
    });
  });

  describe('rejects cross-origin targets', () => {
    it.each([
      ['protocol-relative', '//evil.com'],
      ['triple slash', '///evil.com'],
      ['backslash', '/\\evil.com'],
      ['backslash after slash', '/\\/evil.com'],
      ['absolute https URL', 'https://evil.com'],
      ['absolute http URL', 'http://evil.com'],
      ['javascript scheme', 'javascript:alert(1)'],
      ['data scheme', 'data:text/html,<script>alert(1)</script>'],
      ['leading space then protocol-relative', ' //evil.com'],
      ['relative path', 'app/records'],
      ['empty string', ''],
    ])('%s', (_label, input) => {
      expect(safeRedirectTarget(input)).toBe('/app');
    });
  });

  describe('rejects control-character smuggling', () => {
    // Each of these passes a naive `/^\/(?![/\\])/` check. The URL parser strips the
    // control character, and what is left is protocol-relative.
    it.each([
      ['tab', '\t'],
      ['newline', '\n'],
      ['carriage return', '\r'],
      ['vertical tab', '\v'],
      ['form feed', '\f'],
      ['NUL', '\0'],
      ['unit separator (U+001F)', String.fromCharCode(0x1f)],
      ['DEL (U+007F)', String.fromCharCode(0x7f)],
    ])('%s between the slashes', (_label, char) => {
      expect(safeRedirectTarget(`/${char}/evil.com`)).toBe('/app');
    });

    it('rejects a control character anywhere, not just after the leading slash', () => {
      expect(safeRedirectTarget('/app/records\n//evil.com')).toBe('/app');
    });

    it('sanity check: the naive regex alone would have accepted these', () => {
      // If this ever fails, the naive pattern changed and the rows above may no
      // longer be testing what they claim to test.
      expect(/^\/(?![/\\])/.test('/\t/evil.com')).toBe(true);
    });
  });

  describe('rejects non-string query shapes', () => {
    it.each([
      ['array (?redirect=/a&redirect=/b)', ['/a', '/b']],
      ['empty array', []],
      ['null (bare ?redirect)', null],
      ['undefined (parameter absent)', undefined],
      ['number', 42],
      ['object', { path: '/app' }],
    ])('%s', (_label, input) => {
      expect(safeRedirectTarget(input)).toBe('/app');
    });
  });

  describe('fallback', () => {
    it('defaults to /app', () => {
      expect(safeRedirectTarget(undefined)).toBe('/app');
    });

    it('honours a custom fallback', () => {
      expect(safeRedirectTarget('//evil.com', '/dashboard')).toBe('/dashboard');
    });

    it('returns the fallback unvalidated — callers own that value', () => {
      // Documents the trust boundary: the fallback is a literal in app code, never
      // user input, so it is not re-checked.
      expect(safeRedirectTarget(null, '//caller-owns-this')).toBe('//caller-owns-this');
    });
  });
});
