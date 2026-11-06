# Changelog

All notable changes to this project are documented in this file. The 14.x line (Angular 14, `@nguniversal`, Bootstrap) ends
with `v14.34.0`; its history stays in Git (commit `7b85967`).

## Unreleased

### Breaking

- Rebuilt from scratch on Angular 22 (`ng new` 22.2.6): standalone, zoneless, OnPush by default, SSR with
  `@angular/ssr` (`AngularNodeAppEngine`), Tailwind 4, Vitest, `@lenne.tech/ng-base` 22. Nothing of the 14.x code base is
  carried over; see `migration-guides/` for the move from 14.x.