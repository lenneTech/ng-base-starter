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
(`migration-guides/`, `CHANGELOG.md`, `.github/`, the lockfile).

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
| `node .output/server/index.mjs` | run the build (`PORT`, default 3000)                        |
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

## Deploy

```bash
docker build --build-arg APP_VERSION_COMMIT=$(git rev-parse HEAD) -t app .
docker run -p 3001:3000 -e NG_PUBLIC_SITE_URL=… -e NG_PUBLIC_API_URL=… app
```

The image is non-root, listens on 3000 and has a health check on `/`.

## More

- `CLAUDE.md` / `AGENTS.md`: structure, rules and conventions (for people and coding agents)
- `docs/e2e-auth.md`: running the auth E2E suite and its backend scenarios
- `docs/security-headers.md`: what the server sends and how to add a CSP
- `migration-guides/`: upgrading a generated project

## License

MIT, see `LICENSE`.