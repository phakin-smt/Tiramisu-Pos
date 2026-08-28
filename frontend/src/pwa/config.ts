import type { VitePWAOptions } from 'vite-plugin-pwa';

export const pwaOptions: Partial<VitePWAOptions> = {
  // The app decides when an update may take over — see src/pwa/updateGate.ts.
  registerType: 'prompt',
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
    // A new worker waits until the gate releases it, so it cannot swap assets
    // out from under an open cart.
    skipWaiting: false,
    navigateFallback: '/next/index.html',
    navigateFallbackDenylist: [/^\/api(?:\/|$)/],
    globPatterns: ['**/*.{html,js,css,png,svg,woff2}'],
    // No runtime route for /api on purpose. A NetworkOnly route makes the worker
    // claim every API request and then reject it while offline, which floods the
    // console with "FetchEvent resulted in a network error response" for calls the
    // app expects to fail. With no matching route the worker never claims them:
    // the browser fails them natively with a TypeError, which is exactly what
    // isNetworkFailure() reads to keep unsynced orders pending instead of failed.
    // Nothing caches /api either way, and navigations stay covered by the denylist.
  },
};
