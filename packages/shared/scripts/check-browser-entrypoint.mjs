import { build } from 'esbuild';

const forbidden = new Set([
  'net', 'node:net',
  'crypto', 'node:crypto',
  'async_hooks', 'node:async_hooks',
  'buffer', 'node:buffer',
]);

const forbidBuiltinsPlugin = {
  name: 'forbid-builtins',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (forbidden.has(args.path)) {
        return {
          errors: [{ text: `Forbidden Node builtin in browser bundle: ${args.path}` }],
        };
      }
      return null;
    });
  },
};

await build({
  entryPoints: ['packages/shared/src/browser.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  write: false,
  plugins: [forbidBuiltinsPlugin],
});
