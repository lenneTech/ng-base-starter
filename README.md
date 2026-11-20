# ng-base-starter

Angular 22 starter for lenne.Tech projects: SSR with `@angular/ssr`, Tailwind CSS 4, `@lenne.tech/ng-base` and a
[nest-server-starter](https://github.com/lenneTech/nest-server-starter) backend. It is the Angular counterpart of
[nuxt-base-starter](https://github.com/lenneTech/nuxt-base-starter): same routes, pages, UX rules and backend contract.

## Use it

Inside a fullstack project (recommended):

```bash
lt fullstack init --frontend angular
```

On its own:

```bash
lt frontend angular
```

Both copy this repository into `projects/app` (or the directory you name) and remove the repo-only files
(`.github/`, `CHANGELOG.md`, `extras/`, `migration-guides/`). The project gets its own `package.json` identity:
version `0.0.0`, no `repository`, and the name `app` in a fullstack project or the directory name on its own. On its
own it keeps `pnpm-lock.yaml`; in a fullstack project the monorepo's root lockfile replaces it.

## Develop

Requirements: Node `^22.22.3 || ^24.15.0 || >=26` (`.node-version`: 26), pnpm 11 (pinned in `package.json`), a
nest-server-starter API on port 3000 and MongoDB.

```bash
pnpm install
cp .env.example .env
pnpm run dev            # http://localhost:3001
```

The app must run on port **3001** and the API on **3000**: the API's local defaults trust exactly that origin, and 2FA
and passkeys fail with `403 INVALID_ORIGIN` on any other. `pnpm run dev` refuses a busy port instead of moving. Under
`lt dev up` the CLI sets ports and URLs itself.

| Command                         |                                                             |
| ------------------------------- | ----------------------------------------------------------- |
| `pnpm run dev`                  | dev server with SSR, proxy `/api/*` and `/iam/*` to the API |
| `pnpm run build`                | production build into `.output/` (`NG_OUTPUT_DIR` moves it) |
| `node .output/server/index.mjs` | run the build (`PORT`, default 3001; the image sets 3000)   |
| `pnpm test`                     | unit tests                                                  |
| `pnpm run test:e2e`             | Playwright against a running API (see `docs/e2e-auth.md`)   |
| `pnpm run check`                | everything a commit must pass                               |
| `pnpm run generate-types`       | API client from `${NG_API_URL}/api-docs-json`               |

## Configure

Everything is set at runtime through `NG_*` environment variables, read by the server per request: nothing is baked
into the bundle, so one image runs on every stage. See `.env.example` for the full list. In production at least:

```bash
NG_PUBLIC_SITE_URL=https://example.com
NG_PUBLIC_API_URL=https://api.example.com
NG_API_URL=http://api:3000          # how the SSR server reaches the API
NG_PUBLIC_APP_ENV=production
```

On every other stage (`local`, `develop`, `test`) the bug.lt reporter is on: a "Fehler melden" button that files reports
with screenshot and recent console/network activity in Linear. It needs the Linear values on the server
(`NG_LINEAR_API_KEY`, `NG_LINEAR_TEAM_NAME`, `NG_LINEAR_PROJECT_NAME`); `NG_PUBLIC_LT_BUG_ENABLED=true|false` overrides
the stage rule, `NG_PUBLIC_LT_BUG_*` adjusts the button (see `.env.example`). Without `NG_PUBLIC_APP_ENV` it stays off.

**Sign-in through a social provider (SSO).** Configure the provider in the API (`betterAuth.socialProviders.<id>` in
nest-server, for example `microsoft` with client id, client secret, tenant id and `disableProfilePhoto: true`; redirect
URI at the provider: `<API URL>/iam/callback/<id>`). The tenant id needs nest-server 12.10.0 or later: older versions
hand Better Auth only client id, client secret and `disableSignUp`, drop `tenantId` without a warning, and Microsoft
then admits accounts of every organization. Take 12.10.1 or later: the security release on top of 12.10.0 closes
unauthenticated DoS paths in the GraphQL upload parser and the complexity check. Once configured, `GET /iam/features`
lists the provider, and the login page shows a button "Mit <Name> anmelden" for it; `/auth/callback` finishes the
sign-in. With `NG_PUBLIC_AUTH_SILENT_PROVIDER=<id>`
the login page also tries once per tab to take over an existing provider session without showing anything
(`prompt=none`); without one, the form stays without a message. With that setting the page opens with "Anmeldung wird
geprüft …" instead of the form, already in the server's HTML, and shows the form as soon as it knows the attempt will
not run. After "Abmelden" no tab of this browser signs in silently until the next completed sign-in. A refused account
sees "Kein Zugang"; the provider's own error text never reaches the page, the server redirects it out of the URL
before rendering. Details: `CLAUDE.md`, rule 13 of "Authentication rules".

**No self sign-up? Close it in the API, not only in the app.** Deleting the registration page
(`src/app/auth/register-page.*` and its route in `src/app/app.routes.ts`) or its link removes the form, not the
endpoint: `POST /iam/sign-up/email` stays open, and anybody can create an account with a plain request. A project that
is invitation-only sets `betterAuth.emailAndPassword.disableSignUp: true` in the API's config (nest-server; from 12.3.0
it closes sign-up through social providers too). `GET /iam/features` then reports `signUpEnabled: false`, the login
page hides its "Registrieren" link, and `/auth/register` sends visitors to the login, so the page can stay.

## Deploy

```bash
docker build --build-arg APP_VERSION_COMMIT=$(git rev-parse HEAD) -t app .
docker run -p 3001:3000 -e NG_PUBLIC_SITE_URL=… -e NG_PUBLIC_API_URL=… app
```

The image is non-root, listens on 3000 and has a health check on `/`.

## Versioning

The starter's version always equals the `@lenne.tech/ng-base` version it pins: every ng-base release gets a starter
release with the same number (tag `vX.Y.Z` and a GitHub release). Changes to the starter alone land on `main` and ship
with the next ng-base release. The one exception is v22.0.3, which pins ng-base 22.0.2; ng-base skipped 22.0.3, and
from 22.0.4 on both match. A project generated from the starter has a version of its own.

## More

- `CLAUDE.md` / `AGENTS.md`: structure, rules and conventions (for people and coding agents)
- `docs/e2e-auth.md`: running the auth E2E suite and its backend scenarios
- `docs/security-headers.md`: what the server sends and how to add a CSP
- `migration-guides/`: upgrading a generated project

## License

MIT, see `LICENSE`.