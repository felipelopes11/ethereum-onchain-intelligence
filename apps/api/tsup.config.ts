import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Fully self-contained bundle: the runtime image needs no node_modules.
  noExternal: [/.*/],
  // Optional native addon that pg only loads when explicitly requested.
  external: ['pg-native'],
  // Bundled CommonJS dependencies call require(); provide it in the ESM output.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
