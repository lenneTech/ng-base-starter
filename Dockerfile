# Production image for the Angular SSR app. Works in both monorepo and standalone mode.
#
# Monorepo (build context = monorepo root):
#   docker build -f projects/app/Dockerfile --build-arg APP_DIR=projects/app \
#     --build-arg APP_VERSION_COMMIT=$CI_COMMIT_SHA .
# Standalone (build context = the app repo root, APP_DIR defaults to .):
#   docker build --build-arg APP_VERSION_COMMIT=$CI_COMMIT_SHA .
#
# Nothing is baked into the bundle: every NG_* value (API URL, site URL, stage, analytics host)
# is read by the server at request time, so one image promotes unchanged across stages.

ARG APP_DIR=.

# Stage 1: Install dependencies
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS deps
WORKDIR /app

# Copy every package.json (+ the workspace files) so pnpm resolves deps in both monorepo
# (multiple project manifests) and standalone (a single root manifest) mode. `patches/` carries
# the files `patchedDependencies` in `pnpm-workspace.yaml` points at; absent is fine,
# present-but-uncopyable fails loudly (no `|| true` on that step).
COPY . /tmp/src
RUN find /tmp/src -maxdepth 3 -name "package.json" -not -path "*/node_modules/*" \
      -exec sh -c 'dir=$(dirname "$1" | sed "s|^/tmp/src|.|"); mkdir -p "/app/$dir"; cp "$1" "/app/$dir/"' _ {} \; \
    && cp -f /tmp/src/pnpm-lock.yaml /app/ 2>/dev/null || true \
    && cp -f /tmp/src/pnpm-workspace.yaml /app/ 2>/dev/null || true \
    && cp -f /tmp/src/.npmrc /app/ 2>/dev/null || true \
    && { [ ! -d /tmp/src/patches ] || cp -rf /tmp/src/patches /app/; } \
    && rm -rf /tmp/src

# Provision the exact pnpm declared in package.json (single source of truth). No corepack:
# Node >= 25 no longer ships it. The +sha512 suffix is stripped; npm enforces registry
# integrity for the tarball itself.
RUN npm install -g "$(node -p "require('./package.json').packageManager.split('+')[0]")"

# Install dependencies (--ignore-scripts prevents simple-git-hooks errors in Docker)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: Build
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder
ARG APP_DIR=.
WORKDIR /app

COPY --from=deps /app ./
COPY ${APP_DIR}/ ./${APP_DIR}/

RUN npm install -g "$(node -p "require('./package.json').packageManager.split('+')[0]")"

# The build CONTEXT ROOT `.dockerignore` is the primary filter (lt-monorepo ships one). This
# cleanup is the secondary guard for build artefacts that must never reach the image even if
# that file is missing: a stale `.output`/`.angular` and a developer's `.env`.
# Build by workspace DIRECTORY, not by package name: `pnpm --filter <name>` exits 0 when
# nothing matches, which would silently skip the build.
RUN cd ${APP_DIR} \
    && rm -rf .output .output-* .angular .env .env.* \
    && NG_OUTPUT_DIR=.output pnpm run build

# Stage 3: Production runner
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runner
ARG APP_DIR=.
WORKDIR /app
# Pin the listen address: HOST=0.0.0.0 makes the server reachable from outside the container;
# compose maps host 3001 -> container 3000.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# The Angular SSR output is self-contained (esbuild bundles every server dependency).
COPY --from=builder --chown=nodejs:nodejs /app/${APP_DIR}/.output ./.output

# Build identity for /app/admin/system, which compares it against the API's GET /meta to spot
# a stale container after a partial rollout. Injected at RUNTIME, which keeps the expensive build
# layer cacheable. APP_VERSION_COMMIT is the arg name docker-compose.yml already passes; the
# server falls back to it when a platform exports NG_PUBLIC_APP_COMMIT as an empty string.
ARG APP_VERSION_COMMIT=unknown
ENV NG_PUBLIC_APP_COMMIT=$APP_VERSION_COMMIT \
    APP_VERSION_COMMIT=$APP_VERSION_COMMIT

USER nodejs
EXPOSE 3000

# Container-level liveness probe on a real render. Alpine has no curl; busybox `wget` is built
# in. `127.0.0.1` is in the SSR engine's allowed hosts (angular.json `security.allowedHosts`).
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", ".output/server/index.mjs"]
