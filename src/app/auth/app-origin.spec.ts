import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { appUrl, resolveAppOrigin } from './app-origin';

// Regression guard for the production lockout on https://crm.lenne.tech:
// `runtimeConfig.public.siteUrl` was never declared, so `config.public.siteUrl` was
// `undefined`, and the template literal at the call site turned that into the literal
// text "undefined/auth/reset-password". Better Auth answered 403 INVALID_REDIRECT_URL,
// no reset mail was ever sent, and a user who had forgotten their password could not
// get back in.
//
// The fallback origin comes from the `window.location` stub in `src/test-setup.ts`,
// NOT from happy-dom itself — the setup overrides it. Asserted as a literal rather than
// read back from `window.location.origin`: deriving the expectation from the same
// source the implementation reads would make the test pass whichever field the code
// used. That, plus a stub whose `href` and `origin` were identical, once let an
// `origin` → `href` mutation survive the entire suite — while in a real browser it
// produces `…/auth/forgot-password/auth/reset-password`, i.e. another 403. The stub
// now gives `href` a path, so the two are distinguishable.
const WINDOW_ORIGIN = 'http://localhost:3001';

// The fallback branch warns (it is the misconfigured case); keep the suite quiet and
// let the dedicated test below assert it.
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('resolveAppOrigin', () => {
  it('uses a configured absolute origin', () => {
    expect(resolveAppOrigin('https://crm.lenne.tech')).toBe('https://crm.lenne.tech');
  });

  it('strips a trailing slash so the path is not doubled', () => {
    expect(resolveAppOrigin('https://crm.lenne.tech/')).toBe('https://crm.lenne.tech');
    expect(resolveAppOrigin('https://crm.lenne.tech///')).toBe('https://crm.lenne.tech');
  });

  it('keeps only the origin, discarding path, query and credentials', () => {
    // These all pass a "starts with https://" shape test but would be baked verbatim
    // into every built URL. The downstream check compares origins, so it would never
    // notice the junk — the link would just silently be wrong.
    expect(resolveAppOrigin('https://crm.lenne.tech/de')).toBe('https://crm.lenne.tech');
    expect(resolveAppOrigin('https://crm.lenne.tech/a?b=')).toBe('https://crm.lenne.tech');
    expect(resolveAppOrigin('https://user:pass@crm.lenne.tech')).toBe('https://crm.lenne.tech');
    expect(resolveAppOrigin('https://crm.lenne.tech#x')).toBe('https://crm.lenne.tech');
  });

  it('normalises the host to lower case', () => {
    expect(resolveAppOrigin('HTTPS://CRM.LENNE.TECH')).toBe('https://crm.lenne.tech');
  });

  it('falls back to the window origin when nothing is configured', () => {
    expect(resolveAppOrigin(undefined)).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin('')).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin('   ')).toBe(WINDOW_ORIGIN);
  });

  // The actual production failure: an undeclared runtimeConfig key reaches the call
  // site as the STRING "undefined" once a template literal has stringified it.
  // Treating that as a valid origin is what produced the 403.
  it('rejects the stringified "undefined" / "null" a template literal produces', () => {
    expect(resolveAppOrigin('undefined')).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin('null')).toBe(WINDOW_ORIGIN);
  });

  it('falls back for any non-string value', () => {
    // Not type-system theatre: the runtime config crosses a JSON boundary, so each
    // of these really can reach `config.public.siteUrl` in production — see the
    // `unknown` note on resolveAppOrigin. The type promises nothing, so the runtime
    // guard has to hold on its own.
    expect(resolveAppOrigin(null)).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin(42)).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin({ url: 'https://crm.lenne.tech' })).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin(['https://crm.lenne.tech'])).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin(true)).toBe(WINDOW_ORIGIN);
  });

  it('keeps the parameter typed `unknown`', () => {
    // Pins the widening itself — the thing a well-meaning "tighten this back to
    // string" refactor would break, and which no runtime assertion can catch.
    expectTypeOf(resolveAppOrigin).parameter(0).toBeUnknown();
    expectTypeOf(appUrl).parameter(1).toBeUnknown();
  });

  it('rejects a value that is not an absolute http(s) URL', () => {
    expect(resolveAppOrigin('crm.lenne.tech')).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin('/auth')).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin('//crm.lenne.tech')).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin('not a url at all')).toBe(WINDOW_ORIGIN);
  });

  it('rejects non-http(s) schemes', () => {
    expect(resolveAppOrigin('javascript:alert(1)')).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin('data:text/html,x')).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin('ftp://crm.lenne.tech')).toBe(WINDOW_ORIGIN);
  });

  it('rejects a value containing interior control characters', () => {
    // A tab or newline is stripped by the URL parser before it resolves, so a value
    // that looks harmless in an editor can change meaning. Same rule the sibling
    // `safeRedirectTarget` applies — the two must not diverge.
    expect(resolveAppOrigin('https://crm.lenne\t.tech')).toBe(WINDOW_ORIGIN);
    expect(resolveAppOrigin('https://crm\n.lenne.tech')).toBe(WINDOW_ORIGIN);
  });

  it('tolerates surrounding whitespace, which a .env value routinely carries', () => {
    // Trimmed before the control-character check runs, so a trailing newline from a
    // shell export or an editor is not treated as an attack.
    expect(resolveAppOrigin('  https://crm.lenne.tech\n')).toBe('https://crm.lenne.tech');
  });

  it('accepts http only for loopback hosts, so local dev keeps working', () => {
    expect(resolveAppOrigin('http://localhost:3001')).toBe('http://localhost:3001');
    expect(resolveAppOrigin('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001');
    // `lt dev up` serves the app at https://<slug>.localhost, but a plain-http
    // variant of the same host shape stays legitimate.
    expect(resolveAppOrigin('http://crm.localhost')).toBe('http://crm.localhost');
  });

  it('rejects plain http for a public host — reset links must not travel in clear text', () => {
    expect(resolveAppOrigin('http://crm.lenne.tech')).toBe(WINDOW_ORIGIN);
  });

  it('warns when it falls back, so a misconfiguration leaves a trace', () => {
    resolveAppOrigin(undefined);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('NG_PUBLIC_SITE_URL');
  });

  it('does not warn when a usable origin is configured', () => {
    resolveAppOrigin('https://crm.lenne.tech');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('appUrl', () => {
  it('builds an absolute reset URL from a configured origin', () => {
    expect(appUrl('/auth/reset-password', 'https://crm.lenne.tech')).toBe('https://crm.lenne.tech/auth/reset-password');
  });

  it('never emits the "undefined/..." URL that caused the lockout', () => {
    const url = appUrl('/auth/reset-password', undefined);
    expect(url.startsWith('undefined')).toBe(false);
    expect(url).toBe(`${WINDOW_ORIGIN}/auth/reset-password`);
  });

  it('rejects a path that is not a single-slash absolute path', () => {
    // Without the leading slash the result would be `https://crm.lenne.techauth/x`.
    expect(() => appUrl('auth/reset-password', 'https://crm.lenne.tech')).toThrow(/absolute path/);
    // Protocol-relative and the backslash variant both resolve to another origin.
    expect(() => appUrl('//evil.com', 'https://crm.lenne.tech')).toThrow(/absolute path/);
    expect(() => appUrl('/\\evil.com', 'https://crm.lenne.tech')).toThrow(/absolute path/);
    expect(() => appUrl('/a\tb', 'https://crm.lenne.tech')).toThrow(/absolute path/);
  });

  it('throws instead of returning a relative URL when no origin can be resolved', () => {
    // Simulates SSR: no window, nothing configured. Returning `/auth/reset-password`
    // here would be accepted by Better Auth and then resolved against the API origin
    // — a link to the wrong host, i.e. the same silent wrongness this module prevents.
    vi.stubGlobal('window', undefined);
    try {
      expect(() => appUrl('/auth/reset-password')).toThrow(/outside the browser/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('still works server-side when an origin is configured', () => {
    vi.stubGlobal('window', undefined);
    try {
      expect(appUrl('/auth/reset-password', 'https://crm.lenne.tech')).toBe('https://crm.lenne.tech/auth/reset-password');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
