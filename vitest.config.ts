import { defineConfig } from 'vitest/config';

/**
 * Plain Vitest for the tooling and contract tests in `tests/unit/` (scripts, server helpers,
 * config contracts). They run in Node, not in a DOM, and need no Angular compilation.
 * Component and service specs live next to their code (`src/**\/*.spec.ts`) and run through
 * the Angular builder (`ng test`, `angular.json` → `test`). `pnpm run test:unit` runs both.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // Several specs spawn real child processes (check-server-start, generate-types); inside the
    // monorepo `check` this suite runs in parallel with the API typecheck. Same headroom the Nuxt
    // template and nest-server-starter give their unit configs.
    testTimeout: 30000,
    include: ['tests/unit/**/*.{test,spec}.ts'],
    globals: true,
    // signal-guard: a test may only signal processes it spawned (see the file header).
    setupFiles: ['tests/unit/setup.ts', 'tests/unit/support/signal-guard.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/server/**/*.ts', 'scripts/**/*.mjs'],
    },
  },
});
