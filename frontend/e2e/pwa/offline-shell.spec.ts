import { expect, test } from '@playwright/test';

test('installed shell reopens offline without caching API responses', async ({ context, page }) => {
  await page.goto('/next/');
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/next\/sell$/);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      });
    }
  });
  await expect(page.locator('.connectivity-status.is-online').first()).toContainText('Online');

  const onlineApiStatus = await page.evaluate(async () => (await fetch('/api/health')).status);
  expect(onlineApiStatus).toBe(200);

  const cachedRequests = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (await Promise.all(keys.map((key) => caches.open(key).then((cache) => cache.keys()))))
      .flat()
      .map((request) => new URL(request.url).pathname);
  });
  expect(cachedRequests.some((path) => path.startsWith('/api/'))).toBe(false);

  // Playwright's network emulation does not consistently persist navigator.onLine
  // across a Chromium reload, so keep the browser signal aligned with the network.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
  });
  await context.setOffline(true);
  await expect(page.locator('.connectivity-status.is-offline').first()).toContainText('Offline');
  await expect(page.getByRole('note')).toContainText('ยังไม่สามารถบันทึกการขายแบบออฟไลน์ได้');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ขายสินค้า' })).toBeVisible();

  const offlineApiResult = await page.evaluate(async () => {
    try {
      await fetch('/api/health');
      return 'unexpected-response';
    } catch {
      return 'network-error';
    }
  });
  expect(offlineApiResult).toBe('network-error');

  await page.goto('/next/orders', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/next\/orders$/);
  await expect(page.getByRole('heading', { name: 'ออเดอร์', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก' })).toBeVisible();
});
