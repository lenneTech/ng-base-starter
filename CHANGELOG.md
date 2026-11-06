# Changelog

All notable changes to this project are documented in this file. The 14.x line (Angular 14, `@nguniversal`, Bootstrap) ends
with version 14.34.0 at commit `7b85967` (last tag `v14.0.1`); its history stays in Git.

## [22.0.0](https://github.com/lenneTech/ng-base-starter/compare/v14.0.1...v22.0.0) (2026-11-06)

### Highlights for adopters

- **Rebuilt from scratch on Angular 22.** The 14.x starter (Angular 14, `@nguniversal`, Bootstrap) is replaced by a fresh `ng new` 22.2.6 app on the lenne.Tech stack: standalone and zoneless with signals, SSR with `@angular/ssr`, Tailwind 4, `@lenne.tech/ng-base` 22.0.0, Signal Forms with Valibot and a generated hey-api client. Routes, pages and UX follow nuxt-base-starter 2.38: sign-in with 2FA and passkeys in cookie and JWT mode, security settings, AI chat and AI administration, a system page, and the bug.lt reporter outside production. Every runtime value comes from `NG_*` environment variables the SSR server reads per request, so one image runs on every stage. It is the frontend `lt fullstack init --frontend angular` puts into `projects/app`. Nothing of 14.x carries over: follow the [14.x to 22.0.0 migration guide](https://github.com/lenneTech/ng-base-starter/blob/v22.0.0/migration-guides/14.x-to-22.0.0.md).

### Features

- rebuild ng-base-starter on Angular 22 ([acc2db0](https://github.com/lenneTech/ng-base-starter/commit/acc2db07260b86c73eb802968d662d25f4b6e625))

### Build System

- **deps:** pin @lenne.tech/ng-base 22.0.0 from the registry ([75b3939](https://github.com/lenneTech/ng-base-starter/commit/75b3939d13037764742105f9744b4990d7d858c7))

### CI/CD

- **release:** ignore a missing final newline when cutting the release notes ([f9f3dde](https://github.com/lenneTech/ng-base-starter/commit/f9f3dde5b78b741adf56afeba45b447e669bdf66))