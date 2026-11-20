/**
 * The marks that keep the silent sign-in from looping and from undoing a sign-out (Nuxt template:
 * `tests/unit/utils/social-sign-in.test.ts`, "marks of the silent attempt").
 *
 * A tab is a window-like object with its own `sessionStorage`; tabs of one browser share one `localStorage`.
 */
import { SIGNED_OUT_KEY, SILENT_ATTEMPTED_KEY, socialSignInMarksOf, type SocialSignInMarksView } from './social-sign-in-marks';

/** A `Storage` in memory, enough for the marks. */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
}

/** A storage whose writes do not stick (a full quota that swallows the write, a stubbed store). */
class ForgetfulStorage extends MemoryStorage {
  override setItem(): void {
    // dropped
  }
}

/** A storage that throws on every access. */
class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error('SecurityError');
  }

  override removeItem(): void {
    throw new Error('SecurityError');
  }

  override setItem(): void {
    throw new Error('SecurityError');
  }
}

/** One browser: shared `localStorage`, a fresh `sessionStorage` per tab. */
function browser(local: Storage = new MemoryStorage()) {
  return {
    local,
    tab: (session: Storage = new MemoryStorage()): SocialSignInMarksView => ({ localStorage: local, sessionStorage: session }),
  };
}

/** A tab whose storage accessor throws (blocked by site settings or a private mode). */
function blockedTab(which: 'localStorage' | 'sessionStorage', other: Storage = new MemoryStorage()): SocialSignInMarksView {
  const view = {} as SocialSignInMarksView;
  Object.defineProperty(view, which, {
    get() {
      throw new Error('SecurityError: access denied');
    },
  });
  Object.defineProperty(view, which === 'localStorage' ? 'sessionStorage' : 'localStorage', { value: other });
  return view;
}

describe('marks of the silent attempt', () => {
  it('allow the silent attempt in a fresh tab', () => {
    expect(socialSignInMarksOf(browser().tab()).maySignInSilently()).toBe(true);
  });

  it('allow it once per tab: after the attempt is marked, no further one in this tab', () => {
    const marks = socialSignInMarksOf(browser().tab());

    expect(marks.markSilentAttempt()).toBe(true);
    expect(marks.maySignInSilently()).toBe(false);
  });

  it('keep the "attempted" mark to its tab: a second tab may try once of its own', () => {
    const shared = browser();
    socialSignInMarksOf(shared.tab()).markSilentAttempt();

    expect(socialSignInMarksOf(shared.tab()).maySignInSilently()).toBe(true);
  });

  it('allow none after an explicit sign-out', () => {
    const marks = socialSignInMarksOf(browser().tab());

    expect(marks.markSignedOut()).toBe(true);
    expect(marks.maySignInSilently()).toBe(false);
  });

  it('allow none in any other tab of the browser after a sign-out in one, also a tab opened later', () => {
    const shared = browser();
    const open = shared.tab();
    socialSignInMarksOf(shared.tab()).markSignedOut();

    expect(socialSignInMarksOf(open).maySignInSilently()).toBe(false);
    expect(socialSignInMarksOf(shared.tab()).maySignInSilently()).toBe(false);
  });

  it('allow it again once a sign-in cleared both marks', () => {
    const marks = socialSignInMarksOf(browser().tab());
    marks.markSilentAttempt();
    marks.markSignedOut();

    marks.clear();

    expect(marks.maySignInSilently()).toBe(true);
  });

  it('allow it again in every tab once a sign-in in any tab cleared the sign-out', () => {
    const shared = browser();
    const other = shared.tab();
    socialSignInMarksOf(shared.tab()).markSignedOut();

    socialSignInMarksOf(shared.tab()).clear();

    expect(socialSignInMarksOf(other).maySignInSilently()).toBe(true);
  });

  it('keep "signed out" in localStorage and "attempted" in sessionStorage, under fixed keys of their own', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const marks = socialSignInMarksOf({ localStorage: local, sessionStorage: session });

    marks.markSilentAttempt();
    marks.markSignedOut();

    expect(SILENT_ATTEMPTED_KEY).toBe('lt-social-sign-in:silent-attempted');
    expect(SIGNED_OUT_KEY).toBe('lt-social-sign-in:signed-out');
    expect(session.getItem(SILENT_ATTEMPTED_KEY)).toBe('1');
    expect(session.getItem(SIGNED_OUT_KEY)).toBeNull();
    expect(local.getItem(SIGNED_OUT_KEY)).toBe('1');
    expect(local.getItem(SILENT_ATTEMPTED_KEY)).toBeNull();
  });

  it('clear both marks from both stores', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    for (const store of [session, local]) {
      store.setItem(SILENT_ATTEMPTED_KEY, '1');
      store.setItem(SIGNED_OUT_KEY, '1');
    }

    socialSignInMarksOf({ localStorage: local, sessionStorage: session }).clear();

    expect([session.length, local.length]).toEqual([0, 0]);
  });

  it('honour a "signed out" mark in sessionStorage (where the Nuxt template kept it first) until a sign-in clears it', () => {
    const session = new MemoryStorage();
    session.setItem(SIGNED_OUT_KEY, '1');
    const marks = socialSignInMarksOf({ localStorage: new MemoryStorage(), sessionStorage: session });

    expect(marks.maySignInSilently()).toBe(false);
    marks.clear();
    expect(marks.maySignInSilently()).toBe(true);
  });

  it('leave other entries of both stores alone when cleared', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    session.setItem('draft', 'a');
    local.setItem('lt-color-mode', 'dark');
    const marks = socialSignInMarksOf({ localStorage: local, sessionStorage: session });
    marks.markSilentAttempt();
    marks.markSignedOut();

    marks.clear();

    expect(session.getItem('draft')).toBe('a');
    expect(local.getItem('lt-color-mode')).toBe('dark');
  });

  it('fail closed without a window (server rendering) and with a window without storage', () => {
    for (const view of [null, undefined, {} as SocialSignInMarksView]) {
      const marks = socialSignInMarksOf(view);
      expect(marks.maySignInSilently()).toBe(false);
      expect(marks.markSilentAttempt()).toBe(false);
      expect(marks.markSignedOut()).toBe(false);
      expect(() => marks.clear()).not.toThrow();
    }
  });

  it('fail closed when either store is blocked', () => {
    for (const which of ['localStorage', 'sessionStorage'] as const) {
      expect(socialSignInMarksOf(blockedTab(which)).maySignInSilently()).toBe(false);
      expect(socialSignInMarksOf({ localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage(), [which]: new ThrowingStorage() }).maySignInSilently()).toBe(false);
    }
  });

  it('report a sign-out mark that blocked localStorage refused', () => {
    expect(socialSignInMarksOf(blockedTab('localStorage')).markSignedOut()).toBe(false);
    expect(socialSignInMarksOf({ localStorage: new ThrowingStorage(), sessionStorage: new MemoryStorage() }).markSignedOut()).toBe(false);
  });

  it('clear the sign-out mark in localStorage while sessionStorage is blocked', () => {
    const local = new MemoryStorage();
    local.setItem(SIGNED_OUT_KEY, '1');

    socialSignInMarksOf(blockedTab('sessionStorage', local)).clear();
    expect(local.getItem(SIGNED_OUT_KEY)).toBeNull();

    local.setItem(SIGNED_OUT_KEY, '1');
    socialSignInMarksOf({ localStorage: local, sessionStorage: new ThrowingStorage() }).clear();
    expect(local.getItem(SIGNED_OUT_KEY)).toBeNull();
  });

  it('report a write that did not stick, so the attempt does not start', () => {
    expect(socialSignInMarksOf({ localStorage: new MemoryStorage(), sessionStorage: new ForgetfulStorage() }).markSilentAttempt()).toBe(false);
  });

  it('report a sign-out mark that did not stick', () => {
    expect(socialSignInMarksOf({ localStorage: new ForgetfulStorage(), sessionStorage: new MemoryStorage() }).markSignedOut()).toBe(false);
  });
});
