import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@dialogue-constructor/shared/browser', replacement: path.resolve(__dirname, '../shared/src/browser.ts') },
      { find: '@dialogue-constructor/shared/server', replacement: path.resolve(__dirname, './src/stubs/shared-server.ts') },
      { find: '@dialogue-constructor/shared', replacement: path.resolve(__dirname, '../shared/src/browser.ts') },
    ],
    conditions: ['browser', 'module', 'import', 'default'],
  },
  optimizeDeps: {
    exclude: ['@dialogue-constructor/shared'],
    include: ['@dialogue-constructor/shared/browser'],
  },
  server: {
    port: 5174,
    host: true,
    fs: {
      allow: ['..'],
    },
  },
});

