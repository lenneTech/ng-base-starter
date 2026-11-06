import { type Router, NavigationEnd } from '@angular/router';
import type { CustomProperties, PlausibleRequestPayload } from '@plausible-analytics/tracker';
import { filter } from 'rxjs';

import { analyticsReferrer, analyticsUrl, type IsStaticRoute, reportPageviews, staticRoutes } from './analytics-url';
import { resolveRoute } from './route-resolver';

/**
 * The browser half of `providePlausible()`, loaded only while an analytics host is set: starts the tracker with its own
 * capture off and every URL, referrer and `url` prop passed through the masks of `analytics-url.ts`.
 */
export async function startPlausible(apiHost: string, router: Router, document: Document): Promise<void> {
  const { init, track } = await import('@plausible-analytics/tracker');
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
