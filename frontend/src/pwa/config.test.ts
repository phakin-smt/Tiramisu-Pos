import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('opts into the safe area so the env() insets are not silently zero on iOS', () => {
    // WebKit reports every safe-area-inset as 0 unless viewport-fit=cover is set,
    // which would leave the notch and home-indicator padding in global.css inert.
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const viewport = /<meta name="viewport" content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(viewport).toContain('viewport-fit=cover');
    expect(viewport).toContain('width=device-width');
  });
});
