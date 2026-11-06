/**
 * `isAiRoute()` decides which routes exist only while the API runs its AI module. A route it misses
 * stays reachable with the module off and shows a page whose every request answers 404; a route it
 * catches by mistake is hidden from users of an app without AI.
 */
import { describe, expect, it } from 'vitest';

import { isAiRoute } from './ai-routes';

describe('isAiRoute', () => {
  it.each([
    '/app/ai',
    '/app/ai/',
    '/app/ai/anything',
    '/app/settings/ai',
    '/app/settings/ai/',
    '/app/settings/ai-prompts',
    '/app/admin/ai',
    '/app/admin/ai/connections',
    '/app/admin/ai/slots',
  ])('counts %s as an AI route', (path) => {
    expect(isAiRoute(path)).toBe(true);
  });

  it.each(['/', '/app', '/app/', '/app/settings/security', '/app/admin', '/app/admin/system', '/app/aid', '/app/settings/ai-x', '/app/admin/airline', '/auth/login', '/ai'])(
    'leaves %s alone',
    (path) => {
      expect(isAiRoute(path)).toBe(false);
    },
  );
});
