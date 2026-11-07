import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, DOCUMENT, inject, PLATFORM_ID, provideAppInitializer, type EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { Router } from '@angular/router';
import { LT_RUNTIME_CONFIG } from '@lenne.tech/ng-base';

/**
 * Starts Plausible in the browser, and only while an analytics host is set explicitly (`NG_PUBLIC_PLAUSIBLE_API_HOST`,
 * read at request time like every runtime value). Without one nothing happens: no tracker, no request, no preconnect,
 * never a fallback to plausible.io. The tracker package is loaded only then, so it is in no bundle a project without
 * analytics ships.
 *
 * The tracker's own capture stays off (`autoCapturePageviews: false`): it would report `location.href` the moment it
 * starts, before a page can strip a token. Pageviews come from `reportPageviews`, and `transformRequest` passes the URL,
 * the referrer and the `url` prop of every event through the masks of `analytics-url.ts`. Outbound links, downloads
 * and form submissions are not captured.
 */
export function providePlausible(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      if (!isPlatformBrowser(inject(PLATFORM_ID))) {
        return;
      }
      // Written by src/server.ts (`extend`) from NG_PUBLIC_PLAUSIBLE_API_HOST.
      const host = inject(LT_RUNTIME_CONFIG)['plausibleApiHost'];
      const apiHost = typeof host === 'string' ? host.trim() : '';
      if (!apiHost) {
        return;
      }
      const router = inject(Router);
      const document = inject(DOCUMENT);
      // The app may be gone by the time the chunks have loaded; `startPlausible` then starts nothing.
      const destroyRef = inject(DestroyRef);
      // The tracker and the URL masks load only now (`plausible-start.ts`): no analytics code in the initial bundle.
      void import('./plausible-start').then(({ startPlausible }) => startPlausible(apiHost, { destroyRef, document, router }));
    }),
  ]);
}
