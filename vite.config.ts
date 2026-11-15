import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { proxyPlugin } from './server/proxyPlugin';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), proxyPlugin()],
    define: {
      DEV_EXTENSION_ID: JSON.stringify(''),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@bitchord/shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      },
    },
    // AutoMix's analysis worker (playback/automix): essentia.js's 2021-era
    // Emscripten glue breaks under dep pre-bundling, and the worker is a module.
    optimizeDeps: { exclude: ['essentia.js'] },
    worker: { format: 'es' as const },
    server: {
      host: true,
      port: 5173,
    },
  };
});
