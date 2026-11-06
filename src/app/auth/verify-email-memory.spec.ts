/**
 * app/utils/verify-email-memory.ts: the e-mail address of `/auth/verify-email` lives in the history
 * entry, never in the URL. `tests/e2e/auth-verify-email-url.spec.ts` runs the page against a real API.
 */
import { describe, expect, it } from 'vitest';

// Through `~`, so the file runs unchanged in a project on `srcDir: './src'`.
import { recallVerifyEmail, verifyEmailState } from './verify-email-memory';

describe('verifyEmailState and recallVerifyEmail', () => {
  it('hand the address over and back', () => {
    expect(recallVerifyEmail(verifyEmailState('max@test.com'))).toEqual({ deadToken: '', email: 'max@test.com', verified: false });
  });

  it('carry the outcome of an accepted link', () => {
    expect(recallVerifyEmail(verifyEmailState('max@test.com', { verified: true }))).toEqual({ deadToken: '', email: 'max@test.com', verified: true });
  });

  it('carry the token of a link the server refused, without an address', () => {
    // The link of nest-server 12.6.0+ carries no address; the refused token is what "send a new
    // e-mail" needs after a reload.
    expect(recallVerifyEmail(verifyEmailState('', { deadToken: 'sealed.token' }))).toEqual({ deadToken: 'sealed.token', email: '', verified: false });
  });

  it("find the page's entry among the router's own keys", () => {
    const state = { back: '/auth/login', current: '/auth/verify-email', position: 3, ...verifyEmailState('max@test.com') };

    expect(recallVerifyEmail(state).email).toBe('max@test.com');
  });

  it.each([
    ['no state', null],
    ['a state of another page', { back: '/auth/login', current: '/auth/verify-email' }],
    ['an entry of the wrong shape', { ltVerifyEmail: 'max@test.com' }],
    ['values of the wrong type', { ltVerifyEmail: { deadToken: 7, email: 42, verified: 'yes' } }],
  ])('remember nothing from %s', (_label, state) => {
    expect(recallVerifyEmail(state)).toEqual({ deadToken: '', email: '', verified: false });
  });

  it('read an entry written by 2.37.0, which had no deadToken yet', () => {
    expect(recallVerifyEmail({ ltVerifyEmail: { email: 'max@test.com', verified: true } })).toEqual({ deadToken: '', email: 'max@test.com', verified: true });
  });
});
