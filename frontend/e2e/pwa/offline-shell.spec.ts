import { expect, test, type Page } from '@playwright/test';

async function readCatalogSnapshot(page: Page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === 'BaannoiPOS')) return null;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('BaannoiPOS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains('productSnapshot') || !database.objectStoreNames.contains('metadata')) return null;
      const transaction = database.transaction(['productSnapshot', 'metadata'], 'readonly');
      const requestResult = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [snapshot, metadata] = await Promise.all([
        requestResult(transaction.objectStore('productSnapshot').get('confirmed')),
        requestResult(transaction.objectStore('metadata').get('catalog')),
      ]) as [undefined | { products: Array<{ name: string }> }, undefined | { lastSuccessfulCatalogSyncAt: string; schemaVersion: number }];
      if (!snapshot || !metadata) return null;
      return {
        productNames: snapshot.products.map((product) => product.name),
        lastSuccessfulCatalogSyncAt: metadata.lastSuccessfulCatalogSyncAt,
        schemaVersion: metadata.schemaVersion,
      };
    } finally {
      database.close();
    }
  });
}

test('installed shell reopens offline without caching API responses', async ({ context, page }) => {
  const offlineOrderRequests: string[] = [];
  const offlinePromptPayRequests: string[] = [];
  let trackOfflineRequests = false;
  page.on('request', (request) => {
    if (!trackOfflineRequests) return;
    const path = new URL(request.url()).pathname;
    if (path === '/api/orders' && request.method() === 'POST') offlineOrderRequests.push(request.url());
    if (path === '/api/payment-qr') offlinePromptPayRequests.push(request.url());
  });

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
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toBeVisible();

  await expect.poll(() => readCatalogSnapshot(page)).not.toBeNull();
  const catalogSnapshot = await readCatalogSnapshot(page);
  if (!catalogSnapshot) throw new Error('Confirmed catalog snapshot was not found');
  expect(catalogSnapshot.productNames).toContain('E2E Original');
  expect(catalogSnapshot.lastSuccessfulCatalogSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(catalogSnapshot.schemaVersion).toBe(1);

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
  trackOfflineRequests = true;
  await context.setOffline(true);
  await expect(page.locator('.connectivity-status.is-offline').first()).toContainText('Offline');
  await expect(page.getByRole('note')).toContainText('ยังไม่สามารถบันทึกการขายแบบออฟไลน์ได้');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ขายสินค้า' })).toBeVisible();
  await expect(page.getByText('ใช้ข้อมูลออฟไลน์ล่าสุด')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toBeVisible();

  await page.getByRole('tab', { name: 'E2E Stock' }).click();
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Inactive Stocked ลงตะกร้า' })).toBeVisible();
  await expect(page.getByText('E2E Inactive Empty')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Tiramisu' }).click();
  const addOriginal = page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' });
  await addOriginal.click();
  await addOriginal.click();
  await addOriginal.click();
  await expect(page.getByLabel('ส่วนลด')).toHaveValue('7');
  await expect(page.getByRole('region', { name: 'ยอดรวมตะกร้า' })).toContainText('฿200.00');
  await expect(page.getByRole('button', { name: 'เงินสด' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'QR พร้อมเพย์' })).toBeDisabled();
  await expect(page.getByText('การบันทึกการขายแบบออฟไลน์จะเปิดใช้งานในขั้นตอนถัดไป')).toBeVisible();
  expect(offlineOrderRequests).toHaveLength(0);
  expect(offlinePromptPayRequests).toHaveLength(0);

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
  expect(offlineOrderRequests).toHaveLength(0);
});

test('offline first run does not invent a catalog', async ({ context, page }) => {
  await page.goto('/next/');
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('BaannoiPOS');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('BaannoiPOS deletion was blocked'));
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
  });
  await context.setOffline(true);

  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByText('ยังไม่มีข้อมูลสำหรับใช้งานออฟไลน์')).toBeVisible();
  await expect(page.getByText('กรุณาเชื่อมต่ออินเทอร์เน็ตและเปิดหน้าขายอย่างน้อย 1 ครั้ง')).toBeVisible();
  await expect(page.getByRole('button', { name: /เพิ่ม .* ลงตะกร้า/ })).toHaveCount(0);
});
