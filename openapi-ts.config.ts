import { defineConfig } from '@hey-api/openapi-ts';

import { withOpenApiPath } from './scripts/resolve-api-url.mjs';

/**
 * `NG_API_URL` is resolved and validated by `scripts/generate-types.mjs`, which
 * `pnpm run generate-types` invokes — it loads `<root>/.lt-dev/.env` under `lt dev up`
 * and refuses a URL that belongs to another project.
 *
 * This file keeps a hard guard for the case someone runs `openapi-ts` directly: there is
 * deliberately NO default URL. A fallback to a fixed localhost port silently generated the
 * client from whichever project happened to hold that port, reported success and exited 0
 * (DEV-2802, found in the Nuxt template; same rule here).
 *
 * `withOpenApiPath` appends the OpenAPI path when missing: `lt dev up` exports
 * `NG_API_URL` as the API BASE url.
 */
const apiUrl = (process.env.NG_API_URL || '').trim();

if (!apiUrl) {
  throw new Error(
    [
      'NG_API_URL is not set.',
      '',
      'Use `pnpm run generate-types` — it resolves the URL from `lt dev` and',
      "validates that it really is THIS project's API. To call openapi-ts",
      'directly, set the variable yourself:',
      '',
      '    NG_API_URL=<api-base-url> pnpm exec openapi-ts',
      '',
      'There is deliberately no default (DEV-2802).',
    ].join('\n'),
  );
}

export default defineConfig({
  input: withOpenApiPath(apiUrl),
  output: {
    path: './src/api-client',
    postProcess: ['oxlint', 'oxfmt'],
  },
  // Angular client (HttpClient, so the app's interceptors — credentials, Bearer, 401 probe — apply) plus the
  // `@angular/common` plugin, which emits an `HttpRequest` factory and an `httpResource` per operation.
  // `@hey-api/transformers` is deliberately NOT in this list: dates stay ISO strings in the types, exactly what
  // arrives at runtime (DEV-2897 in the Nuxt template).
  plugins: [
    '@hey-api/client-angular',
    '@hey-api/typescript',
    '@hey-api/sdk',
    {
      name: '@angular/common',
      httpRequests: true,
      httpResources: true,
    },
  ],
});
