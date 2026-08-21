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
      const stores = ['productSnapshot', 'metadata', 'offlineOrders', 'offlineOrderItems', 'offlineStockMovements'];
      if (stores.some((store) => !database.objectStoreNames.contains(store))) return null;
      const transaction = database.transaction(stores, 'readonly');
      const requestResult = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [snapshot, metadata, authorization, orders, items, movements] = await Promise.all([
        requestResult(transaction.objectStore('productSnapshot').get('confirmed')),
        requestResult(transaction.objectStore('metadata').get('catalog')),
        requestResult(transaction.objectStore('metadata').get('offlineAuthorization')),
        requestResult(transaction.objectStore('offlineOrders').getAll()),
        requestResult(transaction.objectStore('offlineOrderItems').getAll()),
        requestResult(transaction.objectStore('offlineStockMovements').getAll()),
      ]) as [
        undefined | { products: Array<{ id: number; name: string; stock: number }> },
        undefined | { lastSuccessfulCatalogSyncAt: string; schemaVersion: number },
        undefined | { enabledAt: string; expiresAt: string },
        Array<{ localOrderId: string; localOrderNumber: string; syncStatus: string }>,
        Array<{ localOrderId: string; productId: number; qty: number; giveawayQty: number }>,
        Array<{ localOrderId: string; semanticType: string; quantity: number }>,
      ];
      if (!snapshot || !metadata) return null;
      return {
        productNames: snapshot.products.map((product) => product.name),
        productStocks: Object.fromEntries(snapshot.products.map((product) => [product.name, product.stock])),
        lastSuccessfulCatalogSyncAt: metadata.lastSuccessfulCatalogSyncAt,
        schemaVersion: metadata.schemaVersion,
        authorization: authorization ?? null,
        orders,
        items,
        movements,
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
  expect(catalogSnapshot.schemaVersion).toBe(2);
  expect(catalogSnapshot.authorization?.enabledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(catalogSnapshot.authorization?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

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
  await expect(page.getByRole('note')).toContainText('ขายเงินสดได้บนอุปกรณ์ที่ได้รับอนุญาต');

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
  await page.getByRole('button', { name: 'เพิ่มจำนวนแถม E2E Original' }).click();
  await expect(page.getByLabel('ส่วนลด')).toHaveValue('0');
  await expect(page.getByRole('region', { name: 'ยอดรวมตะกร้า' })).toContainText('฿138.00');
  await expect(page.getByRole('button', { name: 'เงินสด' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'QR พร้อมเพย์' })).toBeDisabled();
  await expect(page.getByText('PromptPay แบบออฟไลน์จะเปิดใช้งานในขั้นตอนถัดไป')).toBeVisible();
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await page.getByRole('button', { name: 'Exact' }).click();
  const confirmCash = page.getByRole('button', { name: 'ยืนยันรับเงิน' });
  await confirmCash.click();
  await expect(page.getByText(/บันทึกออเดอร์ออฟไลน์ #OFF-.*แล้ว · ยังไม่ได้ Sync/)).toBeVisible();
  await expect(page.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toContainText('คงเหลือ 17 ชิ้น');
  const offlineSale = await readCatalogSnapshot(page);
  if (!offlineSale) throw new Error('Offline sale was not found');
  expect(offlineSale.orders).toHaveLength(1);
  expect(offlineSale.orders[0].localOrderNumber).toMatch(/^OFF-/);
  expect(offlineSale.orders[0].syncStatus).toBe('pending');
  expect(offlineSale.items).toEqual([expect.objectContaining({ qty: 2, giveawayQty: 1 })]);
  expect(offlineSale.movements).toEqual(expect.arrayContaining([
    expect.objectContaining({ semanticType: 'sale', quantity: -2 }),
    expect.objectContaining({ semanticType: 'giveaway', quantity: -1 }),
  ]));
  expect(offlineSale.productStocks['E2E Original']).toBe(17);
  expect(offlineOrderRequests).toHaveLength(0);
  expect(offlinePromptPayRequests).toHaveLength(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toContainText('คงเหลือ 17 ชิ้น');
  const afterReload = await readCatalogSnapshot(page);
  expect(afterReload?.orders).toHaveLength(1);
  expect(afterReload?.productStocks['E2E Original']).toBe(17);

  const offlineApiResult = await page.evaluate(async () => {
    try {
      await fetch('/api/health');
      return 'unexpected-response';
    } catch {
      return 'network-error';
    }
  });
  expect(offlineApiResult).toBe('network-error');

  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true });
  });
  await context.setOffline(false);
  await page.evaluate(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.locator('.connectivity-status.is-online').first()).toContainText('Online');
  await expect(page.getByText('Local Mode · รอ Sync 1 รายการ')).toBeVisible();
  await expect(page.getByText('มีออเดอร์ออฟไลน์ที่ยังไม่ได้ Sync การขายจะยังบันทึกในเครื่อง')).toBeVisible();
  await expect(page.getByText('ใช้สต็อกในเครื่องระหว่างรอ Sync')).toBeVisible();
  await expect(page.getByRole('button', { name: 'QR พร้อมเพย์' })).toBeDisabled();

  await page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' }).click();
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await page.getByRole('button', { name: 'Exact' }).click();
  await page.getByRole('button', { name: 'ยืนยันรับเงิน' }).click();
  await expect(page.getByText('Local Mode · รอ Sync 2 รายการ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toContainText('คงเหลือ 16 ชิ้น');
  const reconnectedSale = await readCatalogSnapshot(page);
  expect(reconnectedSale?.orders).toHaveLength(2);
  expect(reconnectedSale?.productStocks['E2E Original']).toBe(16);
  expect(offlineOrderRequests).toHaveLength(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.connectivity-status.is-online').first()).toContainText('Online');
  await expect(page.getByText('Local Mode · รอ Sync 2 รายการ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toContainText('คงเหลือ 16 ชิ้น');
  expect((await readCatalogSnapshot(page))?.orders).toHaveLength(2);
  expect(offlineOrderRequests).toHaveLength(0);

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
