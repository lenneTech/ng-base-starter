import { describe, expect, it } from 'vitest';

import { DEFAULT_FEATURES, findVerificationToken, parseFeatures } from '../e2e/helpers/auth-backend';

/**
 * The e2e auth helper's two pure functions.
 *
 * They are worth unit tests precisely because the suite that uses them cannot fail on them
 * cleanly: a wrong token or a wrong feature set surfaces as a Playwright timeout on some
 * unrelated assertion, minutes later, with a running backend needed to reproduce it. Both
 * run here in milliseconds with no backend at all.
 */

/** Build a token in the real shape: a JWT whose payload carries the address. */
function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${body}.c2ln`;
}

function logLine(email: string, token: string): string {
  return `[EMAIL VERIFICATION] to ${email}: https://app.test/auth/verify-email?token=${token}\n`;
}

describe('findVerificationToken', () => {
  it('returns the token whose JWT payload carries the address', () => {
    const mine = jwt({ email: 'a@test.com' });
    const log = logLine('other@test.com', jwt({ email: 'other@test.com' })) + logLine('a@test.com', mine);

    expect(findVerificationToken(log, 'a@test.com')).toBe(mine);
  });

  it('matches an address the log echoed in a different case', () => {
    // Better Auth signs `email.toLowerCase()` into the payload, but a spec may well pass the
    // address in the case a user typed it. Comparing them raw silently finds nothing, and the
    // spec then fails on the verification page rather than here.
    const token = jwt({ email: 'mixed@test.com' });

    expect(findVerificationToken(logLine('Mixed@Test.com', token), 'Mixed@Test.com')).toBe(token);
  });

  it('returns the LAST matching token, not the first', () => {
    // A resend re-logs the same address. The freshest token is the only redeemable one; the
    // earlier one is either consumed or superseded.
    const stale = jwt({ email: 'a@test.com', iat: 1 });
    const fresh = jwt({ email: 'a@test.com', iat: 2 });

    expect(findVerificationToken(logLine('a@test.com', stale) + logLine('a@test.com', fresh), 'a@test.com')).toBe(fresh);
  });

  it('never returns another address’s token', () => {
    // The dangerous failure: verifying the wrong account and reporting a pass.
    expect(findVerificationToken(logLine('b@test.com', jwt({ email: 'b@test.com' })), 'a@test.com')).toBeNull();
  });

  it('ignores a line that is not a readable JWT', () => {
    const log = '[EMAIL VERIFICATION] to a@test.com: https://app.test/auth/verify-email?token=not-a-jwt\n';

    expect(findVerificationToken(log, 'a@test.com')).toBeNull();
  });

  it('reads a token that is not the first query parameter', () => {
    const token = jwt({ email: 'a@test.com' });
    const log = `[EMAIL VERIFICATION] https://app.test/auth/verify-email?callbackURL=%2F&token=${token}\n`;

    expect(findVerificationToken(log, 'a@test.com')).toBe(token);
  });

  it('stops the token at the next parameter, not at the end of the line', () => {
    const token = jwt({ email: 'a@test.com' });
    const log = `[EMAIL VERIFICATION] https://app.test/auth/verify-email?token=${token}&callbackURL=%2F\n`;

    expect(findVerificationToken(log, 'a@test.com')).toBe(token);
  });

  it('returns null for an empty log rather than throwing', () => {
    expect(findVerificationToken('', 'a@test.com')).toBeNull();
  });
});

/**
 * nest-server 12.6.0 and newer: the token in the link is sealed (a JWE nobody can read), and the
 * line names the account by `UserKey`, the first 16 hex characters of the SHA-256 of the trimmed,
 * lower-cased address. The legacy format above stays readable, because a project may pair this
 * template with an older server.
 */
describe('findVerificationToken with a UserKey (nest-server 12.6.0+)', () => {
  /** A compact JWE as the link carries it: five base64url parts, nothing readable in any of them. */
  function sealed(seed: string): string {
    return `eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..${seed}iv.${seed}ciphertext.${seed}tag`;
  }

  function keyLine(userKey: string, token: string): string {
    return `[EMAIL VERIFICATION] User: a***@test.com, UserKey: ${userKey}, URL: https://app.test/auth/verify-email?token=${token}\n`;
  }

  // Spelled out instead of computed here: a test that computed the key like the helper would agree
  // with the helper whatever formula both used. These are nest-server's values for the two addresses.
  const KEY_A = '2ca85939294aefb0';
  const KEY_OTHER = 'a37c7e8ee65c7546';

  it('returns the token of the line whose UserKey belongs to the address', () => {
    const mine = sealed('mine');
    const log = keyLine(KEY_OTHER, sealed('other')) + keyLine(KEY_A, mine);

    expect(findVerificationToken(log, 'a@test.com')).toBe(mine);
  });

  it('builds the key from the trimmed, lower-cased address, as nest-server does', () => {
    const token = sealed('mine');

    expect(findVerificationToken(keyLine(KEY_A, token), '  A@Test.com ')).toBe(token);
  });

  it('never returns the token of a line keyed to another address', () => {
    expect(findVerificationToken(keyLine(KEY_OTHER, sealed('other')), 'a@test.com')).toBeNull();
  });

  it('trusts the UserKey over a readable payload in the same line', () => {
    // Once a line names its account, that is the answer. Reading the token as well would let a
    // payload that happens to carry the address hand back another account's link.
    expect(findVerificationToken(keyLine(KEY_OTHER, jwt({ email: 'a@test.com' })), 'a@test.com')).toBeNull();
  });

  it('returns the freshest token across both formats', () => {
    // A server updated between two mails leaves one line of each kind for the same address.
    const fresh = sealed('fresh');
    const log = logLine('a@test.com', jwt({ email: 'a@test.com' })) + keyLine(KEY_A, fresh);

    expect(findVerificationToken(log, 'a@test.com')).toBe(fresh);
  });

  it('leaves the password-reset line alone, which carries a UserKey too', () => {
    const log = `[PASSWORD RESET] User: a***@test.com, UserKey: ${KEY_A}, URL: https://app.test/auth/reset-password?token=reset\n`;

    expect(findVerificationToken(log, 'a@test.com')).toBeNull();
  });
});

describe('parseFeatures', () => {
  it('keeps the defaults for keys the backend omitted', () => {
    // A backend that predates a flag must not read as "flag is false" — that silently SKIPS
    // the spec covering it, and a skipped spec looks exactly like a passing one.
    const parsed = parseFeatures({ enabled: true, jwt: true });

    expect(parsed.jwt).toBe(true);
    expect(parsed.twoFactor).toBe(DEFAULT_FEATURES.twoFactor);
    expect(parsed.emailVerification).toBe(DEFAULT_FEATURES.emailVerification);
  });

  it('reads the resend by token as off on a backend that predates it', () => {
    // The one flag whose default is off: before nest-server 12.6.0 the endpoint does not exist.
    expect(parseFeatures({ enabled: true }).resendVerificationByToken).toBe(false);
    expect(parseFeatures({ enabled: true, resendVerificationByToken: true }).resendVerificationByToken).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'enabled'],
    ['an array', []],
    ['an object without `enabled`', { jwt: true }],
    ['an object whose `enabled` is not a boolean', { enabled: 'yes' }],
  ])('falls back to the defaults for %s', (_label, input) => {
    expect(parseFeatures(input)).toEqual(DEFAULT_FEATURES);
  });

  it('returns a fresh object each time', () => {
    // The specs assign the result to a mutable module-level `features`. Handing out the shared
    // DEFAULT_FEATURES would let one spec file's mutation leak into the next one's baseline.
    const first = parseFeatures(null);
    first.jwt = !first.jwt;

    expect(parseFeatures(null)).toEqual(DEFAULT_FEATURES);
  });
});
