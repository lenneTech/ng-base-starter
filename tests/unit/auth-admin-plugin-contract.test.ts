// @vitest-environment node
/**
 * Better Auth's admin client plugin stays off (the Nuxt template's `tests/unit/auth-admin-plugin-contract.test.ts`,
 * #41).
 *
 * nest-server registers no `admin()` plugin, so every `admin.*` call of Better Auth's client answers 404. ng-base keeps
 * the client plugin off unless `provideLtAuth({ enableAdmin: true })` asks for it; the admin area goes by the role in
 * the session (`isAdminUser`, `tests/e2e/auth-admin-role.spec.ts`). This pins that the app does not switch it on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_CONFIG = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'app', 'app.config.ts'), 'utf8');

describe('Better Auth admin plugin', () => {
  it('is not switched on in app.config.ts (nest-server serves no /iam/admin routes)', () => {
    expect(APP_CONFIG).toContain('provideLtAuth(');
    expect(APP_CONFIG).not.toMatch(/enableAdmin\s*:\s*true/);
  });
});
