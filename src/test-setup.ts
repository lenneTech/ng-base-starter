/**
 * Setup for the specs next to the code (`ng test`), loaded before every spec file (`angular.json` →
 * `test.options.setupFiles`). Same stubs as the Nuxt template's unit setup.
 *
 * The DOM is jsdom, as in a fresh `ng new` (the builder would take happy-dom instead whenever it can resolve it; the
 * starter does not install it, so a generated project with its fresh lockfile tests exactly like this repository).
 *
 * `window.location`: `href` deliberately carries a path while `origin` does not. When both held
 * the same bare origin, code that should read `origin` could read `href` instead and no test
 * could tell the difference (a redirect target built from `href` becomes
 * `…/auth/forgot-password/auth/reset-password`). Keep them distinguishable.
 */
Object.defineProperty(window, 'location', {
  value: {
    hash: '',
    hostname: 'localhost',
    href: 'http://localhost:3001/auth/forgot-password',
    origin: 'http://localhost:3001',
    pathname: '/auth/forgot-password',
    search: '',
  },
  writable: true,
});

/**
 * `ResizeObserver`, which jsdom does not implement: the real Plausible tracker observes the page for its engagement
 * events, and the specs that run it would fail with `ReferenceError: ResizeObserver is not defined`. Observes nothing.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  };
}
