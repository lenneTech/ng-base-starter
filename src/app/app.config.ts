import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import localeDe from '@angular/common/locales/de';
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { provideLtNgBase } from '@lenne.tech/ng-base';
import { provideLtBug } from '@lenne.tech/ng-base/bug/provide';
import { ltAuthInterceptor, provideLtAuth } from '@lenne.tech/ng-base/auth/provide';
import { provideLtUi } from '@lenne.tech/ng-base/ui/provide';

import { providePlausible } from './analytics/plausible';
import { routes } from './app.routes';
import { AUTH_PUBLIC_PATHS } from './auth/auth-paths';
import { AppTitleStrategy } from './shared/title-strategy';

// German UI: dates, numbers and the `date`/`number` pipes follow `de` (the Nuxt template's `UApp` locale).
registerLocaleData(localeDe);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: LOCALE_ID, useValue: 'de' },
    provideRouter(routes, withComponentInputBinding()),
    { provide: TitleStrategy, useExisting: AppTitleStrategy },
    // Event replay keeps clicks and typing that happen before hydration (the Nuxt template needed two DOM repair
    // plugins for that).
    provideClientHydration(withEventReplay()),
    provideHttpClient(withInterceptors([ltAuthInterceptor])),
    // Runtime values come per request from the SSR server (`NG_*`, see `.env.example`); the default below only applies
    // when NG_PUBLIC_API_URL is unset (classic local mode: API on :3000).
    provideLtNgBase({ runtime: { apiUrl: 'http://localhost:3000' } }),
    provideLtAuth({
      interceptor: { enabled: true, publicPaths: [...AUTH_PUBLIC_PATHS] },
      systemSetup: { enabled: true, setupPath: '/auth/setup' },
    }),
    // File upload and AI run on their defaults (`/files`, tus on; `/ai`), so neither `provideLtFiles()` nor
    // `provideLtAi()` is called: an import from `@lenne.tech/ng-base/files` or `/ai` here would move that whole module
    // into the initial bundle of every visitor. Call them with options only, e.g. `provideLtAi({ basePath: '/assistant' })`.
    provideLtUi(),
    // bug.lt reporter, as in the Nuxt template: off in production and without `NG_PUBLIC_APP_ENV` (fails closed),
    // `NG_PUBLIC_LT_BUG_ENABLED` switches it per stage. Reports go to `src/server.ts` (`ltBugReport()`), which files
    // them in Linear with the server-only `NG_LINEAR_*` credentials.
    provideLtBug(),
    providePlausible(),
  ],
};
