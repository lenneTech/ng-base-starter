/**
 * Setup for the specs next to the code (`ng test`, happy-dom), loaded before every spec file
 * (`angular.json` → `test.options.setupFiles`). Same stubs as the Nuxt template's unit setup.
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
