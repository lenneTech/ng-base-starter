import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a real nest-server-starter (API :3000) and this app (:3001). Same shape as the
 * nuxt-base-template's config, so `lt dev test`, lt-monorepo's `app:test` (sharded, blob reporter)
 * and this repo's own workflow run the suite unchanged. See `docs/e2e-auth.md`.
 */

const isCI = !!process.env.CI;
const isWindows = process.platform === 'win32';

// `lt dev test --shard N` runs N built stacks + N Chromium concurrently, which slows SSR navigation.
// The CLI exports `LT_DEV_TEST_SHARDS`, so timeouts relax under that load.
const SHARDED = Number(process.env.LT_DEV_TEST_SHARDS || '0') > 1;

// On CI without the built server the dev server compiles every route on first visit inside the
// budget of whichever test visits it first; relax there too. The BUILT server (`E2E_BUILT_SERVER=true`,
// what CI sets) removes that compile, so it keeps the tight defaults.
const BUILT_SERVER = process.env.E2E_BUILT_SERVER === 'true';
const RELAXED = SHARDED || (isCI && !BUILT_SERVER);

const SITE_URL = process.env.NG_PUBLIC_SITE_URL || 'http://localhost:3001';

export default defineConfig({
  forbidOnly: isCI,
  // Below the CI job timeout, so a wedged run still writes its report.
  globalTimeout: 40 * 60 * 1000,
  // A broken environment (database or API gone) fails every test the same way; five are enough evidence.
  maxFailures: isCI ? 5 : 0,
  fullyParallel: true,
  projects: [{ name: 'Desktop Chrome', use: devices['Desktop Chrome'] }],
  reporter: 'html',
  retries: isCI ? 2 : 0,
  testDir: './tests/e2e',
  timeout: isWindows ? 60000 : RELAXED ? 180_000 : undefined,
  expect: { timeout: RELAXED ? 30_000 : undefined },
  use: {
    baseURL: SITE_URL,
    // Accept the `lt dev` Caddy certificate on `https://*.localhost` (Chromium has its own trust store).
    ignoreHTTPSErrors: true,
    actionTimeout: RELAXED ? 30_000 : undefined,
    navigationTimeout: RELAXED ? 60_000 : undefined,
    locale: 'de',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  // Under `lt dev` / `lt dev test` the app already runs behind Caddy (the CLI exports `LT_DEV_ACTIVE`
  // and sets `NG_PUBLIC_SITE_URL`); Playwright then only targets that URL and starts nothing.
  webServer: process.env.LT_DEV_ACTIVE
    ? undefined
    : [
        {
          // The BUILT server when `E2E_BUILT_SERVER=true` (CI: the `build` job's artifact), the dev
          // server otherwise. The output dir follows `NG_OUTPUT_DIR`, as `scripts/build.mjs` does.
          command: BUILT_SERVER ? `node ${process.env.NG_OUTPUT_DIR || '.output'}/server/index.mjs` : 'pnpm run dev',
          // The port comes from the expected URL, which may name another port than the servers' default 3001.
          env: { PORT: new URL(SITE_URL).port || '3001' },
          // Never test a FOREIGN server that happens to hold :3001 (another checkout's app).
          reuseExistingServer: false,
          stderr: 'pipe',
          stdout: 'pipe',
          timeout: (isCI ? 300 : 120) * 1000,
          url: SITE_URL,
        },
      ],
  // One worker: the WebAuthn virtual authenticator must not be shared across test files.
  workers: 1,
});
