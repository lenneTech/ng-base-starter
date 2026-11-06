/**
 * Dev-server proxy (`ng serve`, `angular.json` → `serve.options.proxyConfig`), the
 * counterpart of the Nuxt template's `vite.server.proxy`.
 *
 * Classic local mode (app :3001, API :3000, `NG_PUBLIC_API_PROXY=true`): the browser calls
 * the API through the app's own origin, so the session cookie is first-party and WebAuthn
 * sees the app origin.
 *
 * - `/api/*` → `NG_API_URL` with `/api` stripped, EXCEPT `/api/build-identity`, which the
 *   app's own server answers (`src/server.ts`).
 * - `/iam/*` → `NG_API_URL` unchanged, for Better Auth redirects that point at `/iam`.
 *
 * `lt dev up` serves app and API on their own HTTPS subdomains and sets
 * `NG_PUBLIC_API_PROXY=false`, so the browser calls the API directly and this proxy idles.
 * The production server has no proxy.
 */
const target = (process.env.NG_API_URL || '').trim() || 'http://localhost:3000';

export default {
  '^/api/(?!build-identity(?:[/?]|$))': {
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
    target,
  },
  '/iam': {
    changeOrigin: true,
    target,
  },
};
