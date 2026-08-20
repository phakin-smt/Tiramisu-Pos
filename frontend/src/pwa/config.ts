import type { VitePWAOptions } from 'vite-plugin-pwa';

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  injectRegister: null,
  manifest: {
    name: 'Baannoi-POS',
    short_name: 'Baannoi POS',
    description: 'Baannoi point-of-sale application',
    start_url: '/next/',
    scope: '/next/',
    display: 'standalone',
    orientation: 'any',
    lang: 'th',
    theme_color: '#573b2d',
    background_color: '#f8f3ee',
    icons: [
      {
        src: '/next/pwa-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/next/pwa-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/next/pwa-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: true,
    navigateFallback: '/next/index.html',
    navigateFallbackDenylist: [/^\/api(?:\/|$)/],
    globPatterns: ['**/*.{html,js,css,png,svg,woff2}'],
    runtimeCaching: [
      {
        urlPattern: /^https?:\/\/[^/]+\/api(?:\/|$)/,
        handler: 'NetworkOnly',
        method: 'GET',
      },
    ],
  },
};
