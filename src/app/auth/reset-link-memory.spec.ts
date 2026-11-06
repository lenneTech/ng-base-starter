/**
 * Contract test for the memory behind `/auth/reset-password`.
 *
 * This guards a security control: what is remembered here can set somebody's password, so a
 * recall must hand it out for the id it was stored under and for nothing else. Which arrival may
 * ask at all is decided by the page and pinned by `tests/e2e/auth-reset-password-token.spec.ts`.
 */
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createResetLinkId, ERASE_RESET_LINK_SCRIPT, forgetResetLink, recallResetLink, rememberResetLink, stampResetLink } from './reset-link-memory';

describe('reset link memory', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** What the page does around a reload: it stores the link, and `pagehide` stamps it. */
  const rememberAndLeave = (id: string, token: string): void => {
    rememberResetLink(id, token);
    stampResetLink();
  };

  it('hands the token out for the id it was stored under, repeatedly', () => {
    rememberAndLeave('entry-a', 'token-a');

    expect(recallResetLink('entry-a')).toBe('token-a');
    expect(recallResetLink('entry-a')).toBe('token-a');
  });

  it.each([
    ['another id', 'entry-b'],
    ['an entry without an id', undefined],
    ['a cleared history state', null],
    ['an empty id', ''],
    ['an id of the wrong type', 42],
  ])('hands out nothing for %s', (_label, id) => {
    rememberAndLeave('entry-a', 'token-a');

    expect(recallResetLink(id)).toBe('');
  });

  it('hands out nothing when nothing was stored', () => {
    expect(recallResetLink('entry-a')).toBe('');
  });

  it('keeps only the newest link', () => {
    rememberAndLeave('entry-a', 'token-a');
    rememberAndLeave('entry-b', 'token-b');

    expect(recallResetLink('entry-a')).toBe('');
    expect(recallResetLink('entry-b')).toBe('token-b');
  });

  describe('after the page was left', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    });

    it('hands the token out right up to the end of the window', () => {
      rememberAndLeave('entry-a', 'token-a');

      vi.advanceTimersByTime(29_999);

      expect(recallResetLink('entry-a')).toBe('token-a');
    });

    it('hands out nothing once the window has passed', () => {
      rememberAndLeave('entry-a', 'token-a');

      vi.advanceTimersByTime(30_000);

      expect(recallResetLink('entry-a')).toBe('');
    });

    it('counts from leaving, not from the arrival', () => {
      rememberResetLink('entry-a', 'token-a');
      vi.advanceTimersByTime(600_000);

      stampResetLink();

      expect(recallResetLink('entry-a')).toBe('token-a');
    });

    it('hands out nothing for a link that was never stamped', () => {
      rememberResetLink('entry-a', 'token-a');

      expect(recallResetLink('entry-a')).toBe('');
    });

    it('stamps nothing when nothing is remembered', () => {
      stampResetLink();

      expect(window.sessionStorage.length).toBe(0);
    });
  });

  it('erases the link', () => {
    rememberAndLeave('entry-a', 'token-a');

    forgetResetLink();

    expect(recallResetLink('entry-a')).toBe('');
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each([
    ['text that is no JSON', '{broken'],
    ['a token of the wrong type', JSON.stringify({ id: 'entry-a', token: 42 })],
    ['a JSON null', 'null'],
    ['a stamp of the wrong type', JSON.stringify({ id: 'entry-a', leftAt: 'now', token: 'token-a' })],
  ])('treats %s as nothing stored', (_label, stored) => {
    rememberAndLeave('entry-a', 'token-a');
    window.sessionStorage.setItem(window.sessionStorage.key(0) as string, stored);

    expect(recallResetLink('entry-a')).toBe('');
  });

  describe('head script', () => {
    // In a context of its own, like the browser: it runs from the document, with nothing imported.
    const runHeadScript = (entries: Array<{ type: string }>, sessionStorage: Pick<Storage, 'removeItem'> = window.sessionStorage): void => {
      runInNewContext(ERASE_RESET_LINK_SCRIPT, { performance: { getEntriesByType: () => entries }, sessionStorage });
    };

    it('keeps the link on a reload', () => {
      rememberAndLeave('entry-a', 'token-a');

      runHeadScript([{ type: 'reload' }]);

      expect(recallResetLink('entry-a')).toBe('token-a');
    });

    it.each([
      ['Back or Forward', [{ type: 'back_forward' }]],
      ['a typed address', [{ type: 'navigate' }]],
      ['a browser without the entry', []],
    ])('erases the link on %s', (_label, entries) => {
      rememberAndLeave('entry-a', 'token-a');

      runHeadScript(entries);

      expect(recallResetLink('entry-a')).toBe('');
    });

    it('does not fail when storage is blocked', () => {
      const blocked: Pick<Storage, 'removeItem'> = {
        removeItem: () => {
          throw new DOMException('Storage is blocked', 'SecurityError');
        },
      };

      expect(() => runHeadScript([{ type: 'navigate' }], blocked)).not.toThrow();
    });
  });

  it('loses the link instead of failing when storage is blocked', () => {
    const blocked = (): never => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    };
    vi.stubGlobal('sessionStorage', { getItem: blocked, removeItem: blocked, setItem: blocked });

    expect(() => rememberResetLink('entry-a', 'token-a')).not.toThrow();
    expect(() => stampResetLink()).not.toThrow();
    expect(recallResetLink('entry-a')).toBe('');
    expect(() => forgetResetLink()).not.toThrow();
  });

  it('creates ids nobody can guess', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createResetLinkId()));

    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('creates ids without `crypto.randomUUID`, which plain-http origins do not have', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });

    expect(createResetLinkId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
