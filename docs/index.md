---
title: ng-base-starter
description: The Angular 22 starter of the lenne.tech stack, with SSR, Tailwind CSS 4, ng-base and a nest-server backend.
navigation:
  title: Overview
---

[ng-base-starter](https://github.com/lenneTech/ng-base-starter) is the template for Angular projects on the lenne.tech
stack: Angular 22 with server-side rendering (`@angular/ssr`), Tailwind CSS 4,
[`@lenne.tech/ng-base`](https://github.com/lenneTech/ng-base) and a
[nest-server-starter](https://github.com/lenneTech/nest-server-starter) backend. It is the Angular counterpart of
[nuxt-base-starter](https://github.com/lenneTech/nuxt-base-starter): same routes, pages, UX rules and backend contract.

You do not clone it by hand. The [lt CLI](https://github.com/lenneTech/cli) copies it into a new project:

```bash
lt fullstack init --frontend angular   # API and app in one monorepo (recommended)
lt frontend angular                    # the app on its own
```

## What a project gets

| Area       | What is included                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rendering  | SSR on Express, render mode per route, one image for every stage (`NG_*` runtime configuration)                                                                    |
| Auth       | Better Auth through `@lenne.tech/ng-base/auth`: e-mail and password, e-mail verification, password reset, 2FA, passkeys, social providers (SSO), first admin setup |
| Pages      | Home, sign-in pages, dashboard, security settings, administration with system page, AI assistant and its admin pages                                               |
| UI         | `@lenne.tech/ng-base/ui` (Spartan-based components, toasts, dialogs, color mode), Lucide icons, dark mode                                                          |
| Forms      | Signal Forms with Valibot schemas                                                                                                                                  |
| API client | Generated from the API's OpenAPI document with `@hey-api/openapi-ts`                                                                                               |
| Quality    | Vitest, Playwright E2E against a real API, oxlint, oxfmt, one `pnpm run check` gate                                                                                |
| Operations | Security headers, Docker image with health check, bug reports to Linear outside production, optional Plausible analytics                                           |

## Pages

| Page                                                              | What it covers                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Getting started](./1.guide/1.getting-started.md)                 | Create a project, run it locally, the commands                                              |
| [Project structure](./1.guide/2.project-structure.md)             | Folders, routes and the conventions the code follows                                        |
| [Configuration](./1.guide/3.configuration.md)                     | The `NG_*` variables, production values, sign-in through a social provider, closing sign-up |
| [ng-base and nest-server](./1.guide/4.ng-base-and-nest-server.md) | npm or vendor mode, the backend contract, the generated API client, versions                |
| [Deployment](./1.guide/5.deployment.md)                           | The Docker image and what a stage needs                                                     |
| [Auth E2E suite](./e2e-auth.md)                                   | Running the Playwright auth tests against the backend configurations                        |
| [Security headers](./security-headers.md)                         | What the server sends and how to add a Content-Security-Policy                              |

The library itself, its components and services, is documented in
[ng-base](https://github.com/lenneTech/ng-base).