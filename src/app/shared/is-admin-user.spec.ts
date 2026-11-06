/**
 * Guards the dual-shape admin check used by:
 *   - the admin route guard (/app/admin/**)
 *   - the default layout (admin nav entry)
 *   - the AI prompts settings page (mutate-foreign-prompt gate)
 *
 * The bug history: the original check only looked at `user.role === 'admin'`
 * (Better Auth singular). Real nest-server projections carry `roles: string[]`,
 * so admins were redirected from /app/admin/** and the nav never appeared.
 */
import { describe, expect, it } from 'vitest';

import { isAdminUser } from './is-admin-user';

describe('isAdminUser', () => {
  it('returns false when user is null', () => {
    expect(isAdminUser(null)).toBe(false);
  });

  it('returns false when user is undefined', () => {
    expect(isAdminUser(undefined)).toBe(false);
  });

  it('returns true when role === "admin" (Better Auth singular shape)', () => {
    expect(isAdminUser({ role: 'admin' })).toBe(true);
  });

  it('returns true when roles contains "admin" (nest-server array shape)', () => {
    expect(isAdminUser({ roles: ['admin'] })).toBe(true);
  });

  it('returns true when both shapes are set and either matches', () => {
    expect(isAdminUser({ role: 'admin', roles: ['user'] })).toBe(true);
    expect(isAdminUser({ role: 'user', roles: ['admin'] })).toBe(true);
  });

  it('returns false for a non-admin user', () => {
    expect(isAdminUser({ role: 'user' })).toBe(false);
    expect(isAdminUser({ roles: ['user', 'editor'] })).toBe(false);
    expect(isAdminUser({})).toBe(false);
  });
});
