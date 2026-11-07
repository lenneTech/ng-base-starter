> Source of the following rules: Angular CLI 22.2.6, `ng new --ai-config=claude-code` (the `@schematics/angular` AI rules file), © Google LLC, MIT License. Kept verbatim; the lenne.Tech rules follow below the line.

You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

## Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized
- Prefer inline templates for small components
- Prefer Signal Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+ and provide signal-based state, type-safe field access, and schema-based validation
- When not using Signal Forms, prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- Do NOT import `CommonModule`, import only the directives and pipes the template uses, such as `AsyncPipe` or `DatePipe`
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection

---

# ng-base-starter

Starter template for Angular 22 applications on the lenne.Tech stack: SSR with `@angular/ssr`, Tailwind 4,
`@lenne.tech/ng-base`, a nest-server-starter backend. `lt fullstack init --frontend angular` and
`lt frontend angular` copy it into `projects/app`. The Nuxt counterpart is nuxt-base-starter; routes, pages, UX
rules and the backend contract are the same.

`CLAUDE.md` and `AGENTS.md` carry the same text (Claude Code reads the first, Codex and other agents the second).
`tests/unit/agent-docs-contract.test.ts` keeps them identical.

## Framework mode (npm vs. vendor): read first

The app consumes `@lenne.tech/ng-base` in one of two modes. Detect it:

- **vendor mode** if `src/core/VENDOR.md` exists: ng-base's library tree is copied into `src/core/` as project code
  (no npm dependency), every `ng-package.json` included. `tsconfig.json` gets one `paths` entry per entry point, each
  pointing at that entry's `lib.entryFile` (`@lenne.tech/ng-base` → `src/core/src/public-api.ts`,
  `@lenne.tech/ng-base/auth/provide` → `src/core/auth/provide/src/public-api.ts`), so imports look the same in both
  modes. Read framework code from `src/core/`.
- **npm mode** otherwise: the framework is the `@lenne.tech/ng-base` dependency (pinned in `dependencies`).

In vendor mode, `src/core/` mirrors upstream. Edit it **only** for changes useful to every consumer, and record them
in `src/core/VENDOR.md`; project-specific code stays outside `src/core/`.

## Tech stack

| Concern       | Choice                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Framework     | Angular 22 (standalone, zoneless, OnPush by default, signals)                                                     |
| Rendering     | SSR via `@angular/ssr` (`AngularNodeAppEngine`, Express), render mode per route in `src/app/app.routes.server.ts` |
| Styling       | Tailwind CSS 4 (`@tailwindcss/postcss`, CSS-first `@theme` in `src/styles.css`), class-based dark mode            |
| UI            | `@lenne.tech/ng-base/ui` (Spartan-based components, toast, dialogs, color mode), `@ng-icons` + Lucide             |
| Forms         | Signal Forms (`@angular/forms/signals`) + Valibot via `validateStandardSchema`                                    |
| API client    | `@hey-api/openapi-ts` with `@hey-api/client-angular` and the `@angular/common` plugin (`httpResource`)            |
| Auth          | Better Auth through `@lenne.tech/ng-base/auth` (cookie and JWT mode)                                              |
| Tests         | Vitest (`ng test` for specs next to the code, plain Vitest for `tests/unit/`), Playwright E2E                     |
| Lint / format | oxlint (all TypeScript, type-aware), angular-eslint (templates only), oxfmt                                       |

## Structure

```
src/
  main.ts, main.server.ts       browser and server bootstrap
  server.ts                     Express server: security headers, HTML no-cache, build identity, robots/sitemap,
                                NG_* runtime config, Angular engine (also the dev server's request handler)
  server/                       pure server helpers (unit-tested in tests/unit/server/)
  index.html, styles.css
  app/
    app.ts, app.config.ts, app.config.server.ts, app.routes.ts, app.routes.server.ts
    shared/                     cross-feature code (runtime config, small utilities)
    <feature>/                  one folder per feature area (home, auth, dashboard, settings, admin, ai, ...)
  api-client/                   generated by `pnpm run generate-types` (never edit by hand)
  core/                         vendored ng-base (vendor mode only)
scripts/                        build, dev, check chain, type generation (plain Node, no install needed)
tests/unit/                     tooling and contract tests (plain Vitest, Node)
tests/e2e/                      Playwright specs and helpers (against a real nest-server-starter)
```

Organise by **feature**, never by type (no `components/`, `services/` folders). One concept per file.

## Commands

| Command                         | What it does                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm run dev`                  | `ng serve` on port 3001 (refuses a busy port), dev proxy `/api/*` and `/iam/*` → `NG_API_URL`, loads `.env`       |
| `pnpm run build`                | production build into `NG_OUTPUT_DIR` (default `.output`) plus the shim `.output/server/index.mjs`                |
| `node .output/server/index.mjs` | the built server (`PORT`, default 3001, the image sets 3000; `HOST`)                                              |
| `pnpm test`                     | `ng test` (specs in `src/`) and Vitest (`tests/unit/`)                                                            |
| `pnpm run test:e2e`             | Playwright against API :3000 and app :3001 (see `docs/e2e-auth.md`)                                               |
| `pnpm run check`                | the full gate: install, audit, suppressions, overrides, peers, format, lint, tests, build, typecheck, server boot |
| `pnpm run generate-types`       | regenerate `src/api-client/` from `${NG_API_URL}/api-docs-json`                                                   |
| `pnpm run check:baseline`       | compare with a fresh `ng new` of the pinned Angular CLI; run after every `ng update`                              |

Run `pnpm run check` before every commit and fix every error, also the ones you did not cause.

### Ports are part of the backend contract

API **3000**, app **3001**. The API's local defaults trust exactly `http://localhost:3001`; another port fails 2FA and
passkeys with `403 INVALID_ORIGIN`, unless the API gets `APP_URL`/`BASE_URL` (what `lt dev up` does). `pnpm run dev`
refuses a busy port instead of moving. Under `lt dev up` use the URLs it prints (`https://<slug>.localhost`), never
`localhost:3000`/`3001`.

### `generate-types` never guesses an API URL (DEV-2802)

`scripts/generate-types.mjs` takes the URL from the shell's `NG_API_URL` or `<repo-root>/.lt-dev/.env` and fails
otherwise; it refuses an URL that belongs to another `lt dev` project. Backend DTO types come only from
`src/api-client/types.gen.ts`, never written by hand. Use the generated `…Resource()` functions for GET requests
(they stay idle without an options factory: `xResource(() => ({}))`), and the SDK or `…Request()` functions for
mutations.

## Runtime configuration (`NG_*`, nothing baked into the bundle)

The SSR server reads every value per request from the environment (`ltAngularRequestHandler` from
`@lenne.tech/ng-base/server` in `src/server.ts`) and writes the public half into each HTML response as
`<script id="ng-runtime-config" type="application/json">`, client-rendered routes included. Read it in code through
`inject(LT_RUNTIME_CONFIG)` (`@lenne.tech/ng-base`); API URLs come from `LtApiUrlService` (server: `NG_API_URL`,
browser: `NG_PUBLIC_API_URL` or the `/api` proxy). Starter values beside ng-base's go through `extend` in
`src/server.ts` (e.g. `plausibleApiHost`).

| Variable                                                             | Scope           | Meaning                                                                                  |
| -------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `NG_PUBLIC_SITE_URL`                                                 | public          | canonical URL, origin of auth mail links, extra allowed SSR host. Required in production |
| `NG_PUBLIC_API_URL` / `NG_API_URL`                                   | public / server | API URL for the browser / for SSR                                                        |
| `NG_PUBLIC_API_PROXY`                                                | public          | browser calls go through `/api` (classic local mode)                                     |
| `NG_PUBLIC_APP_ENV`                                                  | public          | stage label; non-`production` is noindex, `local` adds the no-SMTP hint on verify-email  |
| `NG_PUBLIC_APP_COMMIT` (fallback `APP_VERSION_COMMIT`)               | public          | build identity for `/app/admin/system`                                                   |
| `NG_PUBLIC_STORAGE_PREFIX`, `NG_PUBLIC_COOKIE_PREFIX`                | public          | storage namespace, backend cookie prefix                                                 |
| `NG_PUBLIC_PLAUSIBLE_API_HOST`                                       | public          | analytics host; empty means no tracker at all                                            |
| `NG_ALLOWED_HOSTS`                                                   | server          | extra host names the SSR engine accepts (Angular answers 400 to any other `Host`)        |
| `NG_TRUST_PROXY_HEADERS`                                             | server          | proxy headers SSR trusts (default `x-forwarded-host,x-forwarded-proto`); others dropped  |
| `NG_PUBLIC_LT_BUG_ENABLED`                                           | public          | bug.lt reporter on/off per stage; default: on outside production, off without a stage    |
| `NG_LINEAR_API_KEY`, `NG_LINEAR_TEAM_NAME`, `NG_LINEAR_PROJECT_NAME` | server          | Linear target of the bug.lt reports (`ltBugReport()` in `src/server.ts`)                 |

Never read `process.env` in app code, and never add Angular `environment.ts` files: one image runs on every stage.

## Additions to the Angular best practices above

The block above is the Angular CLI's own rules file (`ng new --ai-config`), kept verbatim;
`tests/unit/agent-docs-contract.test.ts` compares it with the pinned CLI version. On top of it, in this stack:

- File names follow the 2025 style guide: `login-page.ts`, `login-page.html`, `login-page.spec.ts` (no `.component`),
  templates in their own `.html` file as `ng generate component` creates them.
- Organise by feature area, never by type; one concept per file.
- Data loading with resources (`httpResource`, the generated `…Resource()`, `resource()`); keep a resource in the
  component that uses it, share it through a service only when several components need it. Branch the template on
  `isLoading()`, `hasValue()` and `error()`.
- Signal Forms with the Valibot schemas of the feature (`validateStandardSchema`), German messages.
- Lazy routes (`loadComponent`/`loadChildren`) with German route titles.
- Never touch browser globals during SSR (`window`, `document`, `localStorage`): inject `DOCUMENT`, check
  `isPlatformBrowser`, or use `afterNextRender`.

## Styling

Tailwind utility classes in templates only, no component style files, semantic colour tokens only (`bg-primary`,
`text-muted`, never raw palette colours in feature code). Dark mode is the `.dark` class on `<html>`.

`src/styles.css` imports ng-base's `ui/styles/core.css` plus one `ui/styles/components/<name>.css` per Helm or lt
component the templates use (not the full `theme.css`, which would cost the initial-bundle budget). Using a new
component means adding its import; `tests/unit/styles-contract.test.ts` names the missing one.

Dialogs and other overlays: `provideLtUiOverlayDefaults()` sits in the `providers` of `SlimLayout` and `DefaultLayout`
(not in `app.config.ts`, which would pull the UI library into the initial bundle), so toasts show above open dialogs.

## Authentication rules (carried over 1:1 from the Nuxt template)

1. Every backend error on an auth page goes through the error translation (`#LTNS_xxxx` markers); test the input
   first, never `translate(x) || 'fallback'`.
2. Classify Better Auth errors by `error.code`, never by HTTP status. Reset page: dead link (`INVALID_TOKEN`,
   `TOKEN_EXPIRED`, `USER_NOT_FOUND`) → persistent alert with "request new link"; input errors at the field;
   everything else (429, 5xx, network) → "try later".
3. Passwords are SHA-256 hashed in the client before sign-in, sign-up, change/reset, 2FA and system setup, so the
   client `minLength(8)` is the only length rule.
4. `redirectTo`/`callbackURL` are absolute app URLs built from `NG_PUBLIC_SITE_URL`, never relative and never from
   `location` on the server.
5. No `callbackURL` when verifying an e-mail token (the endpoint would answer 302 instead of JSON).
6. `?redirect=` survives login → 2FA → verify-email and is validated (`safeRedirectTarget`: single-slash path only).
7. Forgot-password confirms without revealing whether an account exists.
8. Resend cooldowns use `resendCooldownSeconds` from `GET /iam/features`.
9. Focus moves to the success heading when a form is replaced; dead links get persistent alerts, not toasts.
10. `LTNS_0023` (e-mail not verified) on sign-in → `/auth/verify-email` with the address prefilled.
11. Setup: never show the form while `httpInitEnabled === false`; re-read the status after a 403. With the HTTP init
    closed, `ltSystemSetupGuard` does not redirect (`/` and the login stay reachable): whoever deploys a stage without
    users opens `/auth/setup` directly to see the hint; the API's boot log names the same variables.

Route guards read the client-writable `lt-auth-state` cookie and are **UI gates only**; authorization is the API's job.
Admin check: `roles` contains `admin` or `role === 'admin'`.

## Security

- Security headers, HTML `Cache-Control: private, no-cache` + `Vary: Cookie`, `X-Robots-Tag` for `/app`, `/auth`,
  `/admin`: `src/server.ts`. No Content-Security-Policy by design (see `docs/security-headers.md`).
- Behind the reverse proxy SSR trusts `X-Forwarded-Host` and `X-Forwarded-Proto` by default
  (`src/server/proxy-headers.ts`). Angular checks the forwarded host against the allowed hosts like `Host` (400
  otherwise); the other forwarded headers are dropped.
- Overrides and audit suppressions live in `pnpm-workspace.yaml`, each with its reason, measurement and delete
  condition. Targets are fixed versions. `check-overrides`/`check-suppressions` (part of `check`) fail an entry that
  stopped being load-bearing.

## Tests

- TDD: write the failing test first.
- Component and service specs next to the code (`*.spec.ts`, `ng test`); tooling and contract tests in `tests/unit/`.
- E2E with Playwright against a real nest-server-starter, one worker (WebAuthn virtual authenticator), German locale.
  E2E/CI always set an explicit `NODE_ENV` that has a block in the API's `src/config.env.ts` (`e2e`); verification
  links are read from the API log, which only local/ci/e2e environments print.
- `tests/e2e/helpers/auth-backend.ts` deletes test users directly in MongoDB and refuses any non-loopback URI
  (`LOOPBACK_URI`, identical to the Nuxt template; `E2E_ALLOW_REMOTE_DB=true` only in CI).

## Versioning of this template

The starter follows ng-base, release for release (owner rule, Kai, 2026-11-07, the same as nest-server-starter's):

1. **Same number.** `version` in `package.json` equals the exactly pinned `@lenne.tech/ng-base` version.
2. **Every ng-base version gets its starter version.** Each ng-base version published to npm is followed by a starter
   release with that number (`chore(release): X.Y.Z`, tag `vX.Y.Z`, GitHub release), also when the bump is the only
   change.
3. **Nothing else changes the version.** Starter changes between two ng-base releases are committed to `main` with a
   normal message and leave `version` as it is: no patch bump, no starter-only release, no tag. They ship with the
   next ng-base release.

One exception predates the rule: v22.0.3 pins ng-base 22.0.2. ng-base skipped 22.0.3 for it, and from 22.0.4 on both
carry the same number.

The rule does **not** apply to projects generated from this starter: they carry their own version and upgrade ng-base
on their own schedule, so the two fields differ there by design. That is also why `pnpm run check` has no guard for it
(the check travels into every generated project). Verify by hand before a release commit here:

```bash
node -e "const p=require('./package.json');process.exit(p.version===p.dependencies['@lenne.tech/ng-base']?0:1)" \
  && echo "version matches" || echo "MISMATCH"
```

## Angular CLI MCP

`.mcp.json` registers the project's own Angular CLI as MCP server (`npx ng mcp`, the pinned version, no registry
lookup on start): best practices, documentation search, `ai_tutor`, zoneless/OnPush migration. Prefer it for Angular
API questions over memory.