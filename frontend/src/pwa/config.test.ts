import { describe, expect, it } from 'vitest';

import { pwaOptions } from './config';

describe('PWA configuration', () => {
  it('is scoped to the production React subpath', () => {
    expect(pwaOptions.manifest).toMatchObject({
      name: 'Baannoi-POS',
      short_name: 'Baannoi POS',
      start_url: '/next/',
      scope: '/next/',
      display: 'standalone',
      lang: 'th',
    });
    expect(pwaOptions.workbox?.navigateFallback).toBe('/next/index.html');
  });

  it('never claims an API request, so offline failures stay native network errors', () => {
    // Claiming /api would reject inside the worker and turn a TypeError into a
    // console-spamming FetchEvent error; the sync engine depends on the TypeError.
    expect(pwaOptions.workbox?.runtimeCaching ?? []).toEqual([]);
    expect(pwaOptions.workbox?.navigateFallbackDenylist?.[0].test('/api/orders')).toBe(true);
    expect(pwaOptions.workbox?.navigateFallbackDenylist?.[0].test('/next/sell')).toBe(false);
  });

  it('precaches only build assets and never an API path', () => {
    expect(pwaOptions.workbox?.globPatterns).toEqual(['**/*.{html,js,css,png,svg,woff2}']);
    expect(pwaOptions.workbox?.skipWaiting).toBe(false);
    expect(pwaOptions.registerType).toBe('prompt');
  });
});
