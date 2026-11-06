# Auth E2E Suite — prerequisites and configuration scenarios

How to run `tests/e2e/auth-lifecycle.spec.ts` and `tests/e2e/auth-feature-order.spec.ts`, and
against which backend configurations.

This lived in the two spec file headers until it was deleted by an over-broad regex during a
refactor — silently, because a typecheck does not read comments and nothing else in the repo
carried the knowledge. It lives here now so the next refactor of those files cannot take it
with them.

## Requirements

| Component | Expectation                                                                                  |
| --------- | -------------------------------------------------------------------------------------------- |
| API       | `nest-server-starter` **or** `nest-server` on port 3000, **stdout redirected to a log file** |
| Frontend  | this template on port 3001                                                                   |
| MongoDB   | reachable on `localhost:27017`                                                               |

The stdout redirect is not optional: email-verification tokens are extracted from the server
log, because the token is a **stateless JWT** that is never written to the database (Better
Auth signs it on send and verifies it by signature at redemption — there is no row to read).

`findVerificationToken()` reads both log formats. From nest-server 12.6.0 on the link carries the
token sealed (a JWE nobody can read), and the line names the account by
`UserKey: <16 hex>`, the start of the SHA-256 of the trimmed, lower-cased address; a line with a
`UserKey` is matched by it and nothing else. Before 12.6.0 the line carries Better-Auth's readable
JWT, matched by the address in its payload. 12.6.0 prints the line only in the `local`, `ci` and
`e2e` environments, so an API started otherwise leaves the suite without tokens.

### Where the log is looked for

`tests/e2e/helpers/auth-backend.ts` → `readServerLog()` concatenates every candidate it finds,
in this order:

1. `$NEST_SERVER_LOG`, when set
2. `.lt-dev/api.test.log` — written by `lt dev test`
3. `.lt-dev/api.log` — written by `lt dev up`
4. `/tmp/nest-server.log` — the classic default

2 and 3 are searched upward from the working directory, so a `lt dev` stack at the repo root is
found from inside `projects/app/`.

> **The log contains live bearer credentials.** A verification token grants email verification
> for that account to whoever holds it. Do not upload `.lt-dev/api*.log` or `/tmp/nest-server.log`
> as a CI artefact, and do not ship them to a log aggregator.

### Environment variables

All optional — each falls back to the classic local default.

| Variable                           | Falls back to                           | Used for              |
| ---------------------------------- | --------------------------------------- | --------------------- |
| `NEST_SERVER_LOG`                  | the candidate list above                | explicit log location |
| `NG_PUBLIC_API_URL` / `API_URL`    | `http://localhost:3000`                 | API base              |
| `NG_PUBLIC_SITE_URL` / `APP_URL`   | `http://localhost:3001`                 | app base              |
| `NSC__MONGOOSE__URI` / `MONGO_URI` | `mongodb://127.0.0.1/nest-server-local` | test-data reset       |

Under `lt dev up` / `lt dev test` these are set for you via the `.lt-dev/.env` bridge, so the
same suite runs unchanged against classic ports, a `lt dev` session, and CI.

### An empty database is its own state

The suite assumes an installation that is **past first-run setup**. With zero users the app
routes every visitor to `/auth/setup` instead of `/auth/login`, and specs asserting on the
login redirect fail against a redirect that is entirely correct. `resetTestData()` does not
help here — it deletes, it never seeds.

Migrations do not cover it either: they build the schema, while the first admin is an
application-level decision. Create one before the run:

```bash
curl -X POST http://localhost:3000/system-setup/init \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@test.com","password":"<min 8 chars>","name":"Admin"}'
```

The endpoint refuses once any user exists, so it is safe to leave in a setup script. Locally
this rarely bites, because a development database has users in it from the first day — which
is exactly why it stayed unnoticed until the suite first ran against a fresh CI database.

## Backend options

Any of these can serve the API on port 3000. Each needs its `betterAuth` section configured
per the scenario you want to exercise.

**Option A — `nest-server-starter` (standalone template)**

```bash
cd <nest-server-starter>
npm run start > /tmp/nest-server.log 2>&1 &
```

Config: `src/config.env.ts` → `betterAuth`

**Option B — `nest-server` (direct, e.g. while developing the framework)**

```bash
cd <nest-server>
npm run start > /tmp/nest-server.log 2>&1 &
```

Config: `src/config.env.ts` → `betterAuth`

**Option C — a fullstack project (`lt fullstack init`)**

```bash
cd projects/api
npm run start > /tmp/nest-server.log 2>&1 &
```

Config: `projects/api/src/config.env.ts` → `betterAuth`

**Option D — CI (GitHub Actions), automatic**

The `e2e-auth` job in `.github/workflows/test.yml` does all of the above on every push and
pull request: a `mongo:7` service, `lenneTech/nest-server-starter@main` checked out into
`api/`, built, migrated and started with its stdout redirected to `$NEST_SERVER_LOG`, then
this suite against it. Playwright starts the app itself via its `webServer` block.

It is **blocking**, and deliberately so. This is the only job in that pipeline that exercises
behaviour across the client/server boundary — everything else proves this repo is internally
consistent, which is exactly the property that stayed green while a better-auth version split
broke every 2FA activation in every fullstack project. A non-blocking gate without a
visibility path is worse than no gate: it keeps looking like a net while catching nothing.

The job never uploads `$NEST_SERVER_LOG` as an artefact — see the credentials warning above.
Only the Playwright report is kept, and only on failure.

If the job ever gets too slow to block on, shard it the way lt-monorepo's `app:test` does
(`parallel: 2`) rather than demoting it to advisory.

### The AI module (`ai-visibility.spec.ts`, `ai-settings-mcp-confirmation.spec.ts`)

The app shows its AI pages only while the API runs its AI module, read from the public
`GET /ai/status` (nest-server 12.3.1 or later): 200 `{ mcp }` while it runs, 404 while it is off.
`nest-server-starter` leaves the module off: its `config.env.ts` has no `ai` block. Two variables
switch the module and its MCP server on, with any of the options above:

```bash
NSC__AI__ENCRYPTION_SECRET=<any 32 characters> NSC__AI__MCP__ENABLED=true npm run start > /tmp/nest-server.log 2>&1 &
```

Check it with `curl -s localhost:3000/ai/status`: `{"mcp":true}` means both are on, 404 means the
module is off or nest-server is older.

- `ai-visibility.spec.ts` checks whichever state the API is in: with the module on, the AI links
  show and `/app/settings/ai` opens; with it off, there are no links and the route goes to `/app`.
  A run that sets `NSC__AI__ENCRYPTION_SECRET` expects it on and fails on a 404.
- `ai-settings-mcp-confirmation.spec.ts` needs the MCP server, because the card appears only with
  it. It skips without one, unless the run sets `NSC__AI__MCP__ENABLED`: then it fails.

Both `e2e-auth` jobs (this repo's root workflow and the template's own) set both variables. The
trigger is deliberately not `CI`: an lt-monorepo's `app:test` runs this suite with `CI=true`
against an API whose module is off, where `ai-visibility` checks the off state and the MCP spec
skips.

## Configuration scenarios

The suite detects the live configuration via `GET /iam/features` and adapts — it skips steps
that do not apply. For full coverage, run it against all four. Restart the backend after each
config change.

The auth mode is the one thing `GET /iam/features` does not tell: its `jwt` reports nest-server's
JWT plugin, which is on in cookie mode too. The switch is the top-level `cookies` option (not
`betterAuth.cookies`), `NSC__COOKIES=false` in the environment. Set `E2E_EXPECT_AUTH_MODE`
(`cookie` | `jwt`) for the run: the lifecycle spec then checks the `authMode` the app adopted after
sign-in, and the banner names the scenario.

### Scenario 1 — Zero config (everything enabled, cookies)

Default `nest-server-starter` config, no changes needed. `E2E_EXPECT_AUTH_MODE=cookie`.

Expected features: `emailVerification=true`, `signUpChecks=true`, `twoFactor=true`, `passkey=true`

### Scenario 2 — Cookies, no verification or checks

```ts
betterAuth: {
  emailVerification: false,
  signUpChecks: false,
}
```

`E2E_EXPECT_AUTH_MODE=cookie`. Expected features: `emailVerification=false`, `signUpChecks=false`.

Effect: no terms checkbox, no verification step, direct login after registration.

### Scenario 3 — JWT mode, everything else enabled

```ts
cookies: false,
```

or `NSC__COOKIES=false` in the environment of the start command. `E2E_EXPECT_AUTH_MODE=jwt`.

Effect: sign-in returns a JWT in the body and sets no cookie; the app sends it as bearer header.
Until nest-server 12.7.0 the API answers CORS with a wildcard in this mode, which browsers refuse for
the app's credentialed cross-origin requests: run the app same-origin through its `/api` proxy
(`NG_PUBLIC_API_PROXY=true`). The `e2e-auth` job in `.github/workflows/test.yml` runs the whole suite
twice, in scenario 1 and then in scenario 3 (proxy) against the same database.

### Scenario 4 — JWT mode, no verification or checks

```ts
cookies: false,
betterAuth: {
  emailVerification: false,
  signUpChecks: false,
}
```

`E2E_EXPECT_AUTH_MODE=jwt`, same-origin as in scenario 3.

## Running all four (for an agent or CI)

For each scenario:

1. Edit the config path for your backend option (scenario 3 also works with `NSC__COOKIES=false`
   in the environment of the start command instead).
2. Restart the backend:
   ```bash
   pkill -f "nest-server" 2>/dev/null
   cd <backend-path> && pnpm run start:e2e:dist > /tmp/nest-server.log 2>&1 &
   ```
3. Wait until it answers: `curl -s http://localhost:3000/ > /dev/null`
4. Run: `E2E_EXPECT_AUTH_MODE=<cookie|jwt> npx playwright test tests/e2e/auth-lifecycle.spec.ts`
   (JWT scenarios with `NG_PUBLIC_API_PROXY=true`)
5. Read the configuration banner in the output to confirm which scenario was detected:
   ```
   ╔═════════════════════════════╗
   ║  Szenario X: <description>  ║
   ╚═════════════════════════════╝
   ```
6. **Restore the config to its original state** once all four have run.

## Locator conventions

Prefer accessible-name locators — `getByRole('textbox', { name: … })`, `getByLabel(…)`. They
describe the field the way a user and a screen reader find it, and they survive markup changes.

**Never assert on a generated `for` or `id` value.** Generated ids are neither stable across
renders nor meaningful; the accessible name is what a user and a screen reader rely on.

## Test data

`resetTestData(email)` removes a user and everything Better Auth hung off it — sessions,
accounts, verifications, passkeys, 2FA rows — plus the user's AI settings (`aiUserSettings`). Without it an auth suite starts failing on its
_second_ run rather than its first.

It deletes by exact email match and refuses anything that is not an `@test.com` address, and it
refuses a non-loopback `MONGO_URI` unless `E2E_ALLOW_REMOTE_DB=true` is set explicitly. Use
`generateTestUser()` from `@lenne.tech/ng-base/testing` to get a correctly namespaced,
per-run-unique address.