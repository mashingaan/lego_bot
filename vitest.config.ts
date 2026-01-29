import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Default 60s; use 90s for coverage/CI via env to avoid globally inflating timeouts
    testTimeout: Number(
      process.env.VITEST_TEST_TIMEOUT_MS ?? (process.env.CI || process.env.COVERAGE === '1' ? 90000 : 60000),
    ),
    hookTimeout: 120000,
    // (Optional) teardownTimeout: 120000,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'packages/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['packages/core/src/__tests__/setup.ts'],
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // Disable file parallelism for integration tests to prevent TRUNCATE/FLUSHDB conflicts
    fileParallelism: false,
    maxWorkers: 1,
    // Workaround (Vitest `server.deps.inline` is a last-resort lever): inline only deps implicated by stack traces.
    // Keep list minimal; add more only when stack trace shows same mismatch.
    server: {
      deps: {
        inline: ['html-encoding-sniffer'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: {
        statements: 25,
        branches: 50,
        functions: 50,
        lines: 25,
      },
    },
  },
});
