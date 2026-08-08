import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { version } from './package.json';

// Vendor-Auflösung für den aus dm_workspace_web kopierten Client-Code
// (scripts/sync-dmw-client.mjs): dessen `@dmw/shared`-Imports zeigen auf den
// Vendor-Ordner statt auf ein npm-Paket. Gespiegelt in tsconfig.json (paths)
// und vitest.config.ts.
const dmwAlias = {
  '@dmw/shared': resolve(__dirname, 'src/main/remote/vendor/dmw-shared/index.ts'),
  '@dmw/client': resolve(__dirname, 'src/main/remote/vendor/dmw-client/index.ts')
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: dmwAlias },
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()]
  }
});
