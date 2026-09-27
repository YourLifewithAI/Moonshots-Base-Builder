import { defineConfig } from 'vite';
// installable and offline: manifest, build-time icons, the service worker
import { pwa } from './scripts/pwa.mjs';

export default defineConfig({
  base: './',
  plugins: [pwa()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
