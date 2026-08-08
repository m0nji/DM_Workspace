import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  // Wie in electron.vite.config.ts: @dmw/* zeigt auf den gevendorten Code aus
  // dm_workspace_web (scripts/sync-dmw-client.mjs).
  resolve: {
    alias: {
      '@dmw/shared': resolve(__dirname, 'src/main/remote/vendor/dmw-shared/index.ts'),
      '@dmw/client': resolve(__dirname, 'src/main/remote/vendor/dmw-client/index.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
