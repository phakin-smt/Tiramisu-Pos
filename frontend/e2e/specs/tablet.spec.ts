import { expect, test, type Locator } from '@playwright/test';

import { expectNoHorizontalOverflow, login } from '../support/helpers';

async function swipe(target: Locator, startX: number, startY: number, endX: number, endY: number) {
  await target.evaluate((element, points) => {
    const start = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(start, 'touches', { value: [{ clientX: points.startX, clientY: points.startY }] });
    element.dispatchEvent(start);
    const end = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(end, 'changedTouches', { value: [{ clientX: points.endX, clientY: points.endY }] });
    element.dispatchEvent(end);
  }, { startX, startY, endX, endY });
}

test('tablet workspace, swipe exclusions, modal scrolling, and data views remain usable', async ({ page }) => {
  await login(page);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.mobile-navigation')).not.toBeVisible();
  await expect(page.locator('.sell-cart')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เงินสด' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'QR พร้อมเพย์' })).toBeVisible();
  const columns = await page.locator('.sell-product-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
  await expectNoHorizontalOverflow(page);

  const main = page.locator('.main-content');
  await swipe(main, 700, 300, 560, 305);
  await expect(page).toHaveURL(/\/stock$/);
  await expect(page.getByRole('heading', { name: 'จัดการสต็อก' })).toBeVisible();
  await swipe(main, 700, 250, 560, 430);
  await expect(page).toHaveURL(/\/stock$/);
  const dateInput = page.getByLabel('วันที่สต็อก');
  await swipe(dateInput, 700, 250, 560, 250);
  await expect(page).toHaveURL(/\/stock$/);
  await swipe(page.locator('.table-scroll').first(), 700, 250, 560, 250);
  await expect(page).toHaveURL(/\/stock$/);
  const adjustmentButton = page.getByLabel('เพิ่มเตรียมวันนี้ E2E Stock Item');
  expect((await adjustmentButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('link', { name: 'ตั้งค่า' }).click();
  await page.getByRole('button', { name: /เพิ่มเมนูใหม่/ }).click();
  await expect(page.getByRole('dialog', { name: 'เพิ่มเมนูใหม่' })).toBeVisible();
  await swipe(main, 700, 300, 560, 300);
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('dialog', { name: 'เพิ่มเมนูใหม่' }).getByRole('button', { name: 'ปิด' }).click();

  await page.getByRole('link', { name: 'ออเดอร์' }).click();
  await expect(page.getByRole('heading', { name: 'ออเดอร์', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: 'รายงาน' }).click();
  await expect(page.getByRole('heading', { name: 'รายงาน' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('link', { name: 'ขายสินค้า' }).click();
  await page.getByRole('button', { name: 'สรุป / ปิดยอดวันนี้' }).click();
  const closeDay = page.getByRole('dialog', { name: 'สรุปและปิดยอดวันนี้' });
  const content = closeDay.locator('.close-day-content');
  await expect(content).toHaveCSS('overflow-y', 'auto');
  const scrollState = await content.evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  expect(scrollState.scroll).toBeGreaterThanOrEqual(scrollState.client);
  if (scrollState.scroll > scrollState.client) {
    await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }
  await swipe(main, 700, 300, 560, 300);
  await expect(page).toHaveURL(/\/sell$/);
  await closeDay.getByRole('button', { name: 'กลับไปขาย' }).click();
  await expectNoHorizontalOverflow(page);
});
