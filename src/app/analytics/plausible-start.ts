import type { DestroyRef } from '@angular/core';
import { type Router, NavigationEnd } from '@angular/router';
import type { CustomProperties, PlausibleRequestPayload } from '@plausible-analytics/tracker';
import { filter } from 'rxjs';

import { analyticsReferrer, analyticsUrl, type IsStaticRoute, reportPageviews, staticRoutes } from './analytics-url';
import { resolveRoute } from './route-resolver';

/** What `providePlausible()` hands over from the app that loaded this chunk. */
export interface PlausibleApp {
  /** The app's injector: destroyed means the app is gone, and its router with it. */
  destroyRef: DestroyRef;
  document: Document;
  router: Router;
}

/**
 * The browser half of `providePlausible()`, loaded only while an analytics host is set: starts the tracker with its own
 * capture off and every URL, referrer and `url` prop passed through the masks of `analytics-url.ts`.
 *
 * Starts nothing once the app is destroyed while this chunk and the tracker loaded (a test's TestBed, an app torn down
 * early): its router no longer takes subscribers (`ObjectUnsubscribedError`).
 */
export async function startPlausible(apiHost: string, { destroyRef, document, router }: PlausibleApp): Promise<void> {
  const { init, track } = await import('@plausible-analytics/tracker');
  if (destroyRef.destroyed) {
    return;
  }
  const isStaticRoute: IsStaticRoute = staticRoutes({ resolve: (to) => resolveRoute(router.config, to) });
  const hostname = document.location.hostname;

  init({
    autoCapturePageviews: false,
    captureOnLocalhost: false,
    domain: hostname,
    endpoint: `${apiHost.replace(/\/+$/, '')}/api/event`,
    fileDownloads: false,
    formSubmissions: false,
    outboundLinks: false,
    transformRequest: (payload: PlausibleRequestPayload): PlausibleRequestPayload => ({
      ...payload,
      ...(payload.p ? { p: maskedProps(payload.p, isStaticRoute) } : {}),
      r: analyticsReferrer(payload.r),
      u: analyticsUrl(payload.u, isStaticRoute),
    }),
  });

  if (!apiHost.startsWith('/')) {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = apiHost;
    document.head.appendChild(link);
  }

  reportPageviews((options) => track('pageview', options), {
    afterEach: (hook) => router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => hook()),
    resolve: (to) => resolveRoute(router.config, to),
  });
}

/** The props with the `url` the tracker adds to a click on a tagged link masked like the page URL; non-web URLs dropped. */
function maskedProps(props: CustomProperties, isStaticRoute: IsStaticRoute): CustomProperties {
  const { url, ...rest } = props;
  if (url === undefined) {
    return props;
  }
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? { ...rest, url: analyticsUrl(url, isStaticRoute) } : rest;
}
