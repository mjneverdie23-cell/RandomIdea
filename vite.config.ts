import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
// @ts-expect-error -- plain ESM plugin, typed loosely on purpose.
import { dataFolderPlugin } from './scripts/vite-data-folder.mjs';
// @ts-expect-error -- plain ESM plugin, typed loosely on purpose.
import { polymarketProxyPlugin } from './scripts/vite-polymarket-proxy.mjs';
// @ts-expect-error -- plain ESM plugin, typed loosely on purpose.
import { lolesportsProxyPlugin } from './scripts/vite-lolesports-proxy.mjs';

export default defineConfig({
  plugins: [react(), dataFolderPlugin({ dir: 'data' }), polymarketProxyPlugin(), lolesportsProxyPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
