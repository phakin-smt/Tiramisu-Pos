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

  it('keeps API reads network-only and out of navigation fallback', () => {
    const apiRule = pwaOptions.workbox?.runtimeCaching?.find(
      (rule) => rule.handler === 'NetworkOnly',
    );
    expect(apiRule).toMatchObject({ handler: 'NetworkOnly', method: 'GET' });
    expect(apiRule?.urlPattern).toBeInstanceOf(RegExp);
    expect((apiRule?.urlPattern as RegExp).test('https://example.com/api/auth/status')).toBe(true);
    expect((apiRule?.urlPattern as RegExp).test('https://example.com/next/assets/app.js')).toBe(false);
    expect(pwaOptions.workbox?.navigateFallbackDenylist?.[0].test('/api/orders')).toBe(true);
  });
});
