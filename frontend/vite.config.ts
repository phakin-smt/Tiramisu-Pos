import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import { pwaOptions } from './src/pwa/config';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/next/' : '/',
  plugins: [react(), VitePWA(pwaOptions)],
  server: {
    proxy: {
      '/api': {
        target: mode === 'e2e' ? 'http://127.0.0.1:8011' : 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8011',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: './src/test/setup.ts',
  },
}));
