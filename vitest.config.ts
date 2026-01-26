import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'packages/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['packages/core/src/__tests__/setup.ts'],
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // Workaround (Vitest `server.deps.inline` is a last-resort lever): inline only deps implicated by stack traces.
    // Keep list minimal; add more only when the stack trace shows the same mismatch.
    server: {
      deps: {
        inline: ['html-encoding-sniffer'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
});
