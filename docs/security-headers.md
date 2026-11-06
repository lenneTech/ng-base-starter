# Security headers

What this template sends, what it deliberately does not, and how to add the rest.

## What is sent, and from where

The first Express middleware in `src/server.ts`, `ltSecurityHeaders()` from
`@lenne.tech/ng-base/server`, sets them before any route runs, so they cover SSR pages, the
client-rendered shell, static files, `/api/build-identity` and error responses alike. The
decision lives in ng-base and is unit-tested there.

| Header                              | Value                                                  | Sent           |
| ----------------------------------- | ------------------------------------------------------ | -------------- |
| `X-Content-Type-Options`            | `nosniff`                                              | always         |
| `X-Frame-Options`                   | `DENY`                                                 | always         |
| `Referrer-Policy`                   | `strict-origin`                                        | always         |
| `Permissions-Policy`                | `camera=(), microphone=(), geolocation=(), payment=()` | always         |
| `X-DNS-Prefetch-Control`            | `off`                                                  | always         |
| `X-Permitted-Cross-Domain-Policies` | `none`                                                 | always         |
| `Strict-Transport-Security`         | `max-age=31536000; includeSubDomains`                  | **HTTPS only** |
| `x-powered-by`                      | _(removed)_                                            | always         |

The middleware runs first, so a later route (or `headers` in `src/app/app.routes.server.ts`)
can still override a header where a project needs to, e.g. to be framed.

## Why HSTS is conditional

`Strict-Transport-Security` tells a browser to refuse plain HTTP for a host, and
browsers **remember** it. Sent once from a dev server on `localhost`, it can make
every other local project on `http://localhost` unreachable in that browser — for a
year, with no obvious way back.

So it is sent only when the request actually arrived over HTTPS, decided from
`X-Forwarded-Proto` (behind TurboOps/Traefik and `lt dev up`'s Caddy the connection to
the Node server is plain HTTP, so the header is the only truth) with the connection protocol as
fallback. It is never inferred from an env var — a misconfigured env is exactly the
case that would poison a developer's browser.

## Checking them by hand

Three ways to measure this wrong, all of them observed:

```bash
curl -sI https://<slug>.localhost/ | grep -iE 'x-frame|nosniff|referrer|strict-transport'
```

- **Case-insensitively.** Over HTTPS the connection is HTTP/2, where header names are
  always lowercase (`x-frame-options`); on a direct HTTP/1.1 connection the original
  casing survives. A `grep` without `-i` finds nothing through a proxy and everything
  directly, on identical responses.
- **Against the same target.** `127.0.0.1:4000` and `<slug>.localhost` are the API and
  the app in a `lt dev` setup — two different servers.
- **After the server actually restarted.** A readiness probe that only asks whether
  `/meta` answers is satisfied by the process from _before_ the change. Comparing that
  against a later direct measurement compares two builds and blames the difference on
  whatever sits in between. This is how a "the reverse proxy strips our headers" report
  came about that turned out to be neither the proxy nor the headers.

**HSTS appearing only through the proxy is correct, not a bug.** Caddy terminates TLS
and forwards `x-forwarded-proto: https`, so the app sends it; the direct plain-HTTP
connection is exactly the case where it must stay away. Measured on both sides: the
full set arrives either way, `x-powered-by` is gone, and `strict-transport-security`
shows up only over real HTTPS.

## Why there is no Content-Security-Policy

Not an oversight. A CSP is the one header in this family that breaks a working app
when it is wrong, and a correct one depends on what the project actually loads: fonts,
analytics, an embedded map, a payment iframe, a rich-text editor. A template cannot
know that. A CSP shipped "to be safe" would either be permissive enough to protect
nothing, or break the first project that adds a third-party script — and it would
break it in production, because that is where the third-party script is.

**Add one per project**, and test it. A workable order:

1. Start in report-only. `Content-Security-Policy-Report-Only` sends violations
   without enforcing, so a wrong policy costs a log entry rather than a white page.
2. Collect real violations from real pages, including the ones only an admin sees.
3. Tighten to enforcing once the report is quiet.

Angular-specific notes before you start: the server writes the runtime config as an
inline `<script type="application/json">` (data, never executed, but a strict `script-src`
still has to allow or hash it), SSR writes the hydration state the same way, and Angular
can emit a hash-based CSP itself (`security.autoCsp` in `angular.json`, experimental in 22).
Plausible loads from and reports to its own origin. bug.lt is bundled (screenshots via the lazily
loaded `modern-screenshot`) and posts to this server (`/_bug-lt/report`), which talks to Linear.

The API side of a fullstack project is separate and has its own answer — see
`projects/api/src/main.ts` in projects that already ship one (svl, volksbank/imo hand-roll
the equivalent set there, including a nonce-based CSP for Swagger UI).

## Changing them

Override per route where a project genuinely differs, in `src/app/app.routes.server.ts`:

```ts
{ path: 'embed/**', renderMode: RenderMode.Server, headers: { 'X-Frame-Options': 'SAMEORIGIN' } },
```

Headers a route sets are written after the middleware's, so the route wins.