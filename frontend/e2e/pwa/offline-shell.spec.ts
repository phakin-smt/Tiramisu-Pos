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
      const stores = ['productSnapshot', 'metadata', 'offlineOrders', 'offlineOrderItems', 'offlineStockMovements', 'offlinePaymentConfig'];
      if (stores.some((store) => !database.objectStoreNames.contains(store))) return null;
      const transaction = database.transaction(stores, 'readonly');
      const requestResult = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [snapshot, metadata, authorization, orders, items, movements, paymentConfig] = await Promise.all([
        requestResult(transaction.objectStore('productSnapshot').get('confirmed')),
        requestResult(transaction.objectStore('metadata').get('catalog')),
        requestResult(transaction.objectStore('metadata').get('offlineAuthorization')),
        requestResult(transaction.objectStore('offlineOrders').getAll()),
        requestResult(transaction.objectStore('offlineOrderItems').getAll()),
        requestResult(transaction.objectStore('offlineStockMovements').getAll()),
        requestResult(transaction.objectStore('offlinePaymentConfig').get('promptpay')),
      ]) as [
        undefined | { products: Array<{ id: number; name: string; stock: number }> },
        undefined | { lastSuccessfulCatalogSyncAt: string; schemaVersion: number },
        undefined | { enabledAt: string; expiresAt: string },
        Array<{ localOrderId: string; localOrderNumber: string; syncStatus: string; paymentMethod: string; paymentConfirmation?: string; idempotencyKey?: string; serverOrderNumber?: string }>,
        Array<{ localOrderId: string; productId: number; qty: number; giveawayQty: number }>,
        Array<{ localOrderId: string; semanticType: string; quantity: number }>,
        undefined | { merchantAccountInfo: string; version: number; provisionedAt: string },
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
        paymentConfig: paymentConfig ?? null,
      };
    } finally {
      database.close();
    }
  });
}

test('installed shell reopens offline without caching API responses', async ({ context, page }) => {
  const offlineOrderRequests: string[] = [];
  const replayRequests: string[] = [];
  const offlinePromptPayRequests: string[] = [];
  let trackOfflineRequests = false;
  page.on('request', (request) => {
    if (!trackOfflineRequests) return;
    const path = new URL(request.url()).pathname;
    if (path === '/api/orders' && request.method() === 'POST') {
      // A replay carries the device's own stamp; a cloud sale does not.
      const replay = Boolean(JSON.parse(request.postData() ?? '{}').offline);
      (replay ? replayRequests : offlineOrderRequests).push(request.url());
    }
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
  expect(catalogSnapshot.schemaVersion).toBe(4);
  expect(catalogSnapshot.authorization?.enabledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(catalogSnapshot.authorization?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(catalogSnapshot.paymentConfig).toMatchObject({
    merchantAccountInfo: expect.stringMatching(/^0016A000000677010111/),
    version: 1,
    provisionedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  });

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
  await expect(page.getByRole('note')).toContainText('ขายเงินสดและ PromptPay ได้บนอุปกรณ์ที่ได้รับอนุญาต');

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
  await expect(page.getByRole('button', { name: 'QR พร้อมเพย์' })).toBeEnabled();
  await page.getByRole('button', { name: 'QR พร้อมเพย์' }).click();
  const offlinePromptPay = page.getByRole('dialog', { name: 'QR พร้อมเพย์' });
  await expect(offlinePromptPay.getByText('Local Mode · สร้าง QR ในเครื่อง')).toBeVisible();
  await expect(offlinePromptPay.getByRole('img')).toBeVisible();
  await expect(offlinePromptPay.getByText(/กรุณาตรวจชื่อผู้รับก่อนยืนยันการโอน/)).toBeVisible();
  await offlinePromptPay.getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' }).click();
  await expect(page.getByText(/บันทึกออเดอร์ออฟไลน์ #OFF-.*แล้ว · ยังไม่ได้ Sync/)).toBeVisible();
  await expect(page.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toContainText('คงเหลือ 17 ชิ้น');
  const offlineSale = await readCatalogSnapshot(page);
  if (!offlineSale) throw new Error('Offline sale was not found');
  expect(offlineSale.orders).toHaveLength(1);
  expect(offlineSale.orders[0].localOrderNumber).toMatch(/^OFF-/);
  expect(offlineSale.orders[0].syncStatus).toBe('pending');
  expect(offlineSale.orders[0].paymentMethod).toBe('transfer');
  expect(offlineSale.orders[0].paymentConfirmation).toBe('manual');
  // Every offline order carries the key a later sync will replay it under.
  expect(offlineSale.orders[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
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
  // Still a native TypeError, which is what keeps unsynced orders pending rather
  // than being marked permanently failed.
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

  // Reconnecting drains the queue and releases Local Mode.
  await expect.poll(() => replayRequests.length, { timeout: 15_000 }).toBe(1);
  await expect(page.getByText(/Local Mode · รอ Sync/)).toBeHidden();
  expect(offlineOrderRequests).toHaveLength(0);
  const drained = await readCatalogSnapshot(page);
  expect(drained?.orders).toHaveLength(1);
  expect(drained?.orders[0].syncStatus).toBe('synced');
  expect(drained?.orders[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);

  // With the queue empty the next sale goes to the server again.
  await page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' }).click();
  await page.getByRole('button', { name: 'QR พร้อมเพย์' }).click();
  const reconnectedPromptPay = page.getByRole('dialog', { name: 'QR พร้อมเพย์' });
  await expect(reconnectedPromptPay.getByText('Local Mode · สร้าง QR ในเครื่อง')).toBeHidden();
  await expect(reconnectedPromptPay.getByRole('img')).toBeVisible();
  await reconnectedPromptPay.getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' }).click();
  await expect(page.getByText(/บันทึกออเดอร์ #/)).toBeVisible();
  expect(offlineOrderRequests).toHaveLength(1);
  expect(offlinePromptPayRequests.length).toBeGreaterThan(0);
  const afterCloudSale = await readCatalogSnapshot(page);
  expect(afterCloudSale?.orders).toHaveLength(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.connectivity-status.is-online').first()).toContainText('Online');
  await expect(page.getByText(/Local Mode · รอ Sync/)).toBeHidden();
  expect((await readCatalogSnapshot(page))?.orders).toHaveLength(1);
  expect(replayRequests).toHaveLength(1);

  await page.goto('/next/orders', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/next\/orders$/);
  await expect(page.getByRole('heading', { name: 'ออเดอร์', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก' })).toBeVisible();
  expect(replayRequests).toHaveLength(1);
});

test('offline first run does not invent a catalog', async ({ context, page }) => {
  await page.goto('/next/');
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toBeVisible();
  // Clear only the catalog: the device stays authorized, so this exercises the
  // empty-catalog state rather than the locked-workspace state.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('BaannoiPOS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['productSnapshot', 'metadata'], 'readwrite');
        transaction.objectStore('productSnapshot').clear();
        transaction.objectStore('metadata').delete('catalog');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
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


test('logout revokes offline authorization so the workspace locks when offline', async ({ context, page }) => {
  await page.goto('/next/');
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/next\/sell$/);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toBeVisible();

  // Provisioned: the marker exists and carries no credential material.
  const provisioned = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('BaannoiPOS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const value = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const request = database.transaction('metadata', 'readonly').objectStore('metadata').get('offlineAuthorization');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return value ? Object.keys(value).sort() : null;
    } finally {
      database.close();
    }
  });
  expect(provisioned).toEqual(['enabledAt', 'expiresAt', 'key', 'schemaVersion']);

  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page.getByLabel('PIN')).toBeVisible();

  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
  });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Airplane mode after a logout must not reopen the till.
  await expect(page.getByText('อุปกรณ์นี้ยังไม่ได้รับอนุญาตให้ใช้งานออฟไลน์')).toBeVisible();
  await expect(page.getByRole('button', { name: /เพิ่ม .* ลงตะกร้า/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก' })).toHaveCount(0);
});

test('an oversold offline sale stays reviewable until stock is reconciled', async ({ context, page }) => {
  await page.goto('/next/');
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/next\/sell$/);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toBeVisible();

  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
  });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'ขายสินค้า' })).toBeVisible();

  // Sell offline, then drain the server's stock behind the device's back so the
  // replay is accepted financially but cannot deduct in full.
  const addOriginal = page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' });
  for (let index = 0; index < 3; index += 1) await addOriginal.click();
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await page.getByRole('button', { name: 'Exact' }).click();
  await page.getByRole('button', { name: 'ยืนยันรับเงิน' }).click();
  await expect(page.getByText(/บันทึกออเดอร์ออฟไลน์/)).toBeVisible();

  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true });
  });
  await context.setOffline(false);
  await page.evaluate(async () => {
    await fetch('/api/stock/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 1, verifiedStock: 1 }),
    });
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.connectivity-status.is-online').first()).toContainText('Online');
  await expect(page.getByText(/ต้องตรวจสอบสต็อก/).first()).toBeVisible();

  // The review is inspectable on the stock page and survives a reload.
  await page.goto('/next/stock', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: 'ต้องตรวจสอบสต็อก' });
  await expect(panel.getByText('สินค้า: E2E Original')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(panel.getByText('สินค้า: E2E Original')).toBeVisible();

  await panel.getByLabel('ตรวจนับจริง').fill('4');
  await panel.getByRole('button', { name: 'ยืนยันปรับสต็อก' }).click();

  await expect(panel.getByText(/ปรับสต็อก/)).toBeVisible();
  await expect(panel.getByText('สินค้า: E2E Original')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('ต้องตรวจสอบสต็อก')).toHaveCount(0);
});
