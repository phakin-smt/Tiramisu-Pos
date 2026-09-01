import { expect, test } from '@playwright/test';


test('legacy production root keeps login, Sell, PromptPay, Orders, Stock, and Reports usable', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#sellPage')).toBeVisible();

  await page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' }).click();
  await expect(page.locator('#grandTotalValue')).toHaveText('฿69.00');
  await page.locator('.payment-option[data-payment-method="transfer"]').click();
  const qrModal = page.locator('#qrModal');
  await expect(qrModal).toBeVisible();
  const qrImage = page.locator('#promptPayQr');
  await expect(qrImage).toBeVisible();
  await expect.poll(() => qrImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await qrModal.locator('#qrModalCancel').click();
  await expect(qrModal).toBeHidden();

  for (const [pageId, selector] of [
    ['stockPage', '#stockTable'],
    ['ordersPage', '#ordersTable'],
    ['reportPage', '#reportDaysList'],
  ] as const) {
    await page.locator(`.nav-link[data-page="${pageId}"]`).click();
    await expect(page.locator(`#${pageId}`)).toBeVisible();
    await expect(page.locator(selector)).toBeVisible();
  }
});

test('React production build keeps auth and all /next deep links inside its basename', async ({ page }) => {
  await page.goto('/next/');
  await expect(page).toHaveURL(/\/next\/$/);
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/next\/sell$/);
  await expect(page.getByRole('heading', { name: 'ขายสินค้า' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'จัดการสต็อก' })).toHaveAttribute('href', '/next/stock');

  for (const [route, heading] of [
    ['sell', 'ขายสินค้า'],
    ['stock', 'จัดการสต็อก'],
    ['orders', 'ออเดอร์'],
    ['reports', 'รายงาน'],
    ['analytics', 'วิเคราะห์'],
    ['settings', 'ตั้งค่า'],
  ] as const) {
    await page.goto(`/next/${route}`);
    await expect(page).toHaveURL(new RegExp(`/next/${route}$`));
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page.getByLabel('PIN')).toBeVisible();
  await page.goto('/next/orders');
  await expect(page.getByLabel('PIN')).toBeVisible();
});

test('the sidebar stays pinned to the viewport while the page scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/next/');
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/next\/sell$/);

  const sidebar = page.locator('.sidebar');
  const logout = sidebar.getByRole('button', { name: 'ออกจากระบบ' });
  await expect(sidebar).toBeVisible();
  const before = await sidebar.boundingBox();
  expect(before?.y).toBe(0);

  await page.mouse.wheel(0, 2000);
  await expect.poll(async () => Math.round(await page.evaluate(() => window.scrollY))).toBeGreaterThan(0);

  // Still anchored at the top of the viewport, and logout is still reachable.
  const after = await sidebar.boundingBox();
  expect(after?.y).toBe(0);
  await expect(logout).toBeInViewport();
  await expect(sidebar.getByRole('link', { name: /ขายสินค้า/ })).toBeInViewport();
});
