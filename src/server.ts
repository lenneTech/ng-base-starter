import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule } from '@angular/ssr/node';
import { ltBugReport } from '@lenne.tech/ng-base/bug/server';
import { ltAngularRequestHandler, ltApiProxy, ltBuildIdentity, ltSecurityHeaders } from '@lenne.tech/ng-base/server';
import express from 'express';
import type { Server } from 'node:http';
import { join } from 'node:path';

import { version } from '../package.json';
import { resolveAllowedHosts } from './server/allowed-hosts';
import { resolveListenAddress } from './server/listen-address';
import { buildRobotsTxt, buildSitemapXml, robotsTagFor } from './server/seo-routes';
import { starterRuntimeConfig } from './server/starter-runtime-config';

/**
 * The production server (and, through `reqHandler`, the request handler `ng serve` uses in development). Counterpart of
 * the Nuxt template's Nitro server, built from `@lenne.tech/ng-base/server`:
 *
 * - security headers on every response (no CSP by design, see `docs/security-headers.md`), `x-powered-by` off;
 * - `GET /api/build-identity` for the drift check on `/app/admin/system`;
 * - `POST /_bug-lt/report` for the bug.lt reporter outside production (`ltBugReport()`, Linear credentials server-only);
 * - robots.txt, sitemap.xml and `X-Robots-Tag` for `/app`, `/auth`, `/admin` (`src/server/seo-routes.ts`);
 * - the `/api/*` proxy to the API, only with `NG_PUBLIC_API_PROXY=true` (classic local mode);
 * - every other request rendered by Angular with the `NG_*` runtime config of THIS request: handed to SSR as request
 *   context and written into the HTML as `<script id="ng-runtime-config">` (client-rendered routes too), HTML marked
 *   `Cache-Control: private, no-cache` + `Vary: Cookie`.
 *
 * `/.well-known/security.txt` is off, as in the Nuxt template; switch it on where somebody reads the address:
 * `app.use(ltSecurityTxt({ contact: 'mailto:security@example.com' }))` before the static files.
 *
 * Started by `.output/server/index.mjs`, the shim `scripts/build.mjs` writes (the lt-monorepo contract: CI and
 * `lt dev test` run `node .output/server/index.mjs`).
 */

const browserDistFolder = join(import.meta.dirname, '../browser');

export const app = express();
app.disable('x-powered-by');

const angularApp = new AngularNodeAppEngine({ allowedHosts: resolveAllowedHosts(process.env) });

app.use(ltSecurityHeaders());

/** The per-route `X-Robots-Tag`, before any route runs, so it travels with every response of a private path. */
app.use((req, res, next) => {
  const robotsTag = robotsTagFor(req.path, process.env['NG_PUBLIC_APP_ENV']);
  if (robotsTag) {
    res.setHeader('X-Robots-Tag', robotsTag);
  }
  next();
});

app.use(ltBuildIdentity({ version }));

/** bug.lt reports (`POST /_bug-lt/report`) → Linear; answers 404 where the reporter is off (production by default). */
app.use(ltBugReport());

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(buildRobotsTxt({ appEnv: process.env['NG_PUBLIC_APP_ENV'], siteUrl: process.env['NG_PUBLIC_SITE_URL'] }));
});

app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').send(buildSitemapXml({ siteUrl: process.env['NG_PUBLIC_SITE_URL'] }));
});

app.use(ltApiProxy());

/** Static files from /browser (hashed bundles, `public/`). */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/** Everything else is rendered by Angular, with the runtime config of this request. */
app.use(
  ltAngularRequestHandler(angularApp, {
    appVersion: version,
    // Starter values next to ng-base's own; read in the app as `inject(LT_RUNTIME_CONFIG)['plausibleApiHost']`.
    extend: starterRuntimeConfig,
  }),
);

/** Listens on `PORT` (default 3001, the app port; the image sets 3000) and `HOST` (all interfaces when unset). */
export function startServer(): Server {
  const { host, port } = resolveListenAddress(process.env);
  const server = app.listen(port, host as string, (error?: Error) => {
    if (error) {
      throw error;
    }
    console.log(`Node Express server listening on http://${host ?? 'localhost'}:${port}`);
  });
  const shutdown = (): void => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

/** Started directly (`node .output/server/server.mjs`) or via PM2; the shim calls `startServer()` itself. */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  startServer();
}

/** Request handler used by the Angular CLI (dev server and build). */
export const reqHandler = createNodeRequestHandler(app);
