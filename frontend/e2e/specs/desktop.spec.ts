import { expect, test } from '@playwright/test';

import { addDays, bangkokDate, expectNoHorizontalOverflow, login, orderCard, payWithCash, productCard } from '../support/helpers';

test.describe.configure({ mode: 'serial' });

test('authentication protects routes and supports login and logout', async ({ page }) => {
  await page.goto('/orders');
  await expect(page.getByLabel('PIN')).toBeVisible();
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole('heading', { name: 'ออเดอร์', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ออเดอร์' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page.getByLabel('PIN')).toBeVisible();
  await page.goto('/stock');
  await expect(page.getByLabel('PIN')).toBeVisible();
});

test('cash, PromptPay, cancellation, reports, analytics, and close-day use the real backend', async ({ page }) => {
  const orderRequests: string[] = [];
  const closeRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/orders') && request.method() === 'POST') orderRequests.push(request.url());
    if (request.url().endsWith('/api/reports/close-day') && request.method() === 'POST') closeRequests.push(request.url());
  });
  await login(page);
  await expectNoHorizontalOverflow(page);

  await productCard(page, 'E2E Original').click({ clickCount: 3 });
  await page.getByLabel('เพิ่มจำนวนแถม E2E Original').click();
  await expect(page.getByLabel('ส่วนลด')).toHaveValue('0');
  const requestsBeforeHold = orderRequests.length;
  await page.getByRole('button', { name: 'พักออเดอร์' }).click();
  await expect(page.getByText(/พักออเดอร์แล้ว/)).toBeVisible();
  await expect(page.getByRole('status', { name: 'จำนวน E2E Original' })).toHaveText('3');
  expect(orderRequests).toHaveLength(requestsBeforeHold);
  await page.getByLabel('ลดจำนวนแถม E2E Original').click();
  await expect(page.getByLabel('ส่วนลด')).toHaveValue('7');
  await payWithCash(page);
  const cashSuccess = page.getByText(/บันทึกออเดอร์ #/);
  await expect(cashSuccess).toBeVisible();
  const cashOrder = /#([^\s]+)/.exec(await cashSuccess.textContent() ?? '')?.[1];
  expect(cashOrder).toBeTruthy();
  await expect(page.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeVisible();
  await expect(productCard(page, 'E2E Original')).toContainText('คงเหลือ 17 ชิ้น');
  await expect(page.locator('.sell-summary')).toContainText('฿200.00');

  await productCard(page, 'E2E Coffee').click();
  await page.route('**/api/payment-qr?*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.getByRole('button', { name: 'QR พร้อมเพย์' }).click();
  const qrModal = page.getByRole('dialog', { name: 'QR พร้อมเพย์' });
  await expect(qrModal).toContainText('ยอดชำระ ฿69.00');
  const transferConfirm = qrModal.getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' });
  await expect(transferConfirm).toBeDisabled();
  expect(orderRequests).toHaveLength(1);
  const qrImage = qrModal.getByRole('img');
  await expect(qrImage).toBeVisible();
  await expect.poll(() => qrImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(transferConfirm).toBeEnabled();
  await transferConfirm.click();
  const transferSuccess = page.getByText(/บันทึกออเดอร์ #/);
  await expect(transferSuccess).toBeVisible();
  const transferOrder = /#([^\s]+)/.exec(await transferSuccess.textContent() ?? '')?.[1];
  expect(transferOrder).toBeTruthy();
  await expect(qrModal).not.toBeVisible();
  await expect(page.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeVisible();
  await expect(productCard(page, 'E2E Coffee')).toContainText('คงเหลือ 14 ชิ้น');
  expect(orderRequests).toHaveLength(2);

  await page.getByRole('link', { name: 'ออเดอร์' }).click();
  const transferCard = orderCard(page, transferOrder!);
  await expect(transferCard).toContainText('โอน/พร้อมเพย์');
  await transferCard.getByRole('button', { name: 'ดูรายละเอียด' }).click();
  await expect(transferCard).toContainText('E2E Coffee');
  const cashCard = orderCard(page, cashOrder!);
  page.once('dialog', (dialog) => dialog.accept());
  await cashCard.getByRole('button', { name: `ยกเลิกออเดอร์ ${cashOrder}`, exact: true }).click();
  await expect(cashCard).toContainText('ยกเลิกแล้ว');
  await expect(cashCard.getByRole('button', { name: `ยกเลิกออเดอร์ ${cashOrder}`, exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: 'ขายสินค้า' }).click();
  await expect(productCard(page, 'E2E Original')).toContainText('คงเหลือ 20 ชิ้น');
  await expect(page.locator('.sell-summary')).toContainText('฿69.00');

  await page.getByRole('link', { name: 'รายงาน' }).click();
  await page.locator('.report-day-button').first().click();
  await expect(page.locator('.report-detail')).toContainText('฿69.00');
  await expect(page.locator('.report-detail').getByText('เงินสด').first().locator('..')).toContainText('฿0.00');
  await expect(page.locator('.report-detail').getByText('เงินโอน').locator('..')).toContainText('฿69.00');
  await expect(page.locator('.report-detail').getByText('ส่วนลดรวม').locator('..')).toContainText('฿0.00');
  await expect(page.locator('.report-detail').getByText('ต้นทุนรวม').locator('..')).toContainText('฿25.00');
  await expect(page.locator('.report-detail').getByText('กำไรขั้นต้น').locator('..')).toContainText('฿44.00');
  await expect(page.locator('.report-detail')).toContainText('E2E Coffee');

  await page.getByRole('link', { name: 'วิเคราะห์' }).click();
  await page.getByRole('button', { name: '1 วัน' }).click();
  const analyticsMetrics = page.locator('.metrics-grid').first();
  await expect(analyticsMetrics.getByText('ยอดขาย', { exact: true }).locator('..')).toContainText('฿69.00');
  await expect(analyticsMetrics.getByText('ออเดอร์', { exact: true }).locator('..')).toContainText('1');
  await expect(page.getByRole('heading', { name: 'แนวโน้มยอดขาย' }).locator('..')).toContainText('฿69');
  await page.getByRole('button', { name: '7 วัน' }).click();
  await expect(page.getByRole('button', { name: '7 วัน' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('link', { name: 'ขายสินค้า' }).click();
  await page.getByRole('button', { name: 'สรุป / ปิดยอดวันนี้' }).click();
  const closeModal = page.getByRole('dialog', { name: 'สรุปและปิดยอดวันนี้' });
  await expect(closeModal).toContainText('฿69.00');
  expect(closeRequests).toHaveLength(0);
  await closeModal.getByRole('button', { name: 'ยืนยันปิดยอดวันนี้' }).click();
  await expect(closeModal.getByText(/บันทึกเวลาปิดยอดแล้ว/)).toBeVisible();
  expect(closeRequests).toHaveLength(1);
  await closeModal.getByRole('button', { name: 'อัปเดตเวลาปิดยอด' }).click();
  await expect.poll(() => closeRequests.length).toBe(2);
  await closeModal.getByRole('button', { name: 'กลับไปขาย' }).click();

  await productCard(page, 'E2E Coffee').click();
  await payWithCash(page);
  await expect(page.getByText(/บันทึกออเดอร์ #/)).toBeVisible();
  await expect(page.locator('.sell-summary')).toContainText('฿138.00');
  expect(orderRequests).toHaveLength(3);
  await expectNoHorizontalOverflow(page);
});

test('stock adjustments, planning, and product management confirm server state', async ({ page }) => {
  await login(page, '/stock');
  const stockRow = () => page.locator('tr').filter({ hasText: 'E2E-STK' });
  const expectStock = async (prepared: string, giveaway: string, waste: string, remaining: string) => {
    await expect(stockRow().locator('td').nth(1)).toHaveText(prepared);
    await expect(stockRow().locator('td').nth(3)).toHaveText(giveaway);
    await expect(stockRow().locator('td').nth(4)).toHaveText(waste);
    await expect(stockRow().locator('td').nth(5)).toHaveText(remaining);
  };
  await expectStock('0', '0', '0', '3');
  await page.getByLabel('เพิ่มเตรียมวันนี้ E2E Stock Item').click();
  await expectStock('1', '0', '0', '4');
  await page.getByLabel('เพิ่มแถมวันนี้ E2E Stock Item').click();
  await expectStock('1', '1', '0', '3');
  await page.getByLabel('เพิ่มเสียวันนี้ E2E Stock Item').click();
  await expectStock('1', '1', '1', '2');

  const undoRow = () => page.locator('tr').filter({ hasText: 'E2E-UNDO' });
  await expect(undoRow().locator('td').nth(1)).toHaveText('1');
  await expect(undoRow().locator('td').nth(3)).toHaveText('1');
  await expect(undoRow().locator('td').nth(4)).toHaveText('1');
  await page.getByLabel('ลดเตรียมวันนี้ E2E Undo Item').click();
  await expect(undoRow().locator('td').nth(1)).toHaveText('0');
  await expect(undoRow().locator('td').nth(5)).toHaveText('3');
  await page.getByLabel('ลดแถมวันนี้ E2E Undo Item').click();
  await expect(undoRow().locator('td').nth(3)).toHaveText('0');
  await expect(undoRow().locator('td').nth(5)).toHaveText('4');
  await page.getByLabel('ลดเสียวันนี้ E2E Undo Item').click();
  await expect(undoRow().locator('td').nth(4)).toHaveText('0');
  await expect(undoRow().locator('td').nth(5)).toHaveText('5');
  await expect(page.getByLabel('เพิ่มแถมวันนี้ E2E Zero Stock')).toBeDisabled();
  await expect(page.getByLabel('เพิ่มเสียวันนี้ E2E Zero Stock')).toBeDisabled();

  const today = await bangkokDate(page);
  await page.getByLabel('วันที่สต็อก').fill(addDays(today, -1));
  await expect(page.getByText('อ่านอย่างเดียว')).toBeVisible();
  await expect(page.getByLabel('เพิ่มเตรียมวันนี้ E2E Stock Item')).toHaveCount(0);
  await page.getByLabel('วันที่สต็อก').fill(today);
  await expect(page.getByText('ปรับสต็อกวันนี้')).toBeVisible();

  const future = addDays(today, 2);
  const planForm = page.locator('.stock-plan-form');
  await planForm.locator('select').selectOption({ label: 'E2E Stock Item (E2E-STK)' });
  await planForm.locator('input[type="date"]').fill(future);
  await planForm.locator('input[type="number"]').fill('2');
  await planForm.getByRole('button', { name: 'เพิ่มแผน' }).click();
  const plan = page.locator('.stock-plan-list').filter({ hasText: 'E2E Stock Item' });
  await expect(plan).toContainText('รอดำเนินการ');
  page.once('dialog', (dialog) => dialog.accept());
  await plan.getByRole('button', { name: 'ยกเลิกแผน E2E Stock Item' }).click();
  await expect(page.getByText('ยกเลิกแผนแล้ว')).toBeVisible();
  await expect(page.locator('.stock-plan-list').filter({ hasText: 'E2E Stock Item' })).toHaveCount(0);

  await page.getByRole('link', { name: 'ตั้งค่า' }).click();
  await page.getByRole('button', { name: /เพิ่มเมนูใหม่/ }).click();
  const form = page.getByRole('dialog', { name: 'เพิ่มเมนูใหม่' });
  await form.getByLabel('รหัสเมนู').fill('E2E-MAN');
  await form.getByLabel('ชื่อเมนู').fill('E2E Managed Product');
  await form.getByLabel('หมวดหมู่').fill('E2E Managed');
  await form.getByLabel('ราคาขาย (บาท)').fill('75');
  await form.getByLabel('ต้นทุน/ชิ้น (บาท)').fill('30');
  await form.getByLabel('จำนวนคงเหลือ').fill('5');
  await form.getByLabel('จุดสั่งเตรียมขั้นต่ำ').fill('1');
  await form.getByRole('button', { name: 'บันทึกเมนู' }).click();
  await expect(page.getByText('เพิ่มเมนูใหม่แล้ว')).toBeVisible();
  await page.getByPlaceholder('ชื่อหรือรหัสเมนู').fill('E2E-MAN');
  let product = page.locator('.product-admin-item').filter({ hasText: 'E2E-MAN' });
  await expect(product).toContainText('E2E Managed Product');
  await product.getByRole('button', { name: 'แก้ไข E2E Managed Product' }).click();
  const edit = page.getByRole('dialog', { name: 'แก้ไขเมนู' });
  await edit.getByLabel('ชื่อเมนู').fill('E2E Managed Product Edited');
  await edit.getByRole('button', { name: 'บันทึกเมนู' }).click();
  await expect(page.getByText('แก้ไขเมนูแล้ว')).toBeVisible();
  product = page.locator('.product-admin-item').filter({ hasText: 'E2E-MAN' });
  await product.getByLabel('เปิดขาย E2E Managed Product Edited').click();
  await expect(page.getByText(/พักขาย E2E Managed Product Edited แล้ว/)).toBeVisible();
  await page.getByLabel('สถานะ').selectOption('inactive');
  await expect(product).toContainText('พักขาย');
  page.once('dialog', (dialog) => dialog.accept());
  await product.getByRole('button', { name: 'ลบ E2E Managed Product Edited' }).click();
  await expect(page.getByText('ลบเมนูแล้ว')).toBeVisible();
  await expect(page.locator('.product-admin-item').filter({ hasText: 'E2E-MAN' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
