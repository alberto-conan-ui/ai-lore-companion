import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// Bundle @ai-lore-companion/core into main/preload so Electron's CJS loader
// does not have to require an ESM workspace package. Native modules stay
// external (better-sqlite3, chokidar) — Electron loads them at runtime.
const externalize = externalizeDepsPlugin({ exclude: ['@ai-lore-companion/core'] });

export default defineConfig({
  main: {
    plugins: [externalize],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalize],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
