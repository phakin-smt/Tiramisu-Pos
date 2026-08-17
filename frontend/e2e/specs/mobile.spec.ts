import { expect, test } from '@playwright/test';

import { expectNoHorizontalOverflow, login, productCard } from '../support/helpers';

test('mobile Sell navigation, cart sheet, and payment controls remain usable', async ({ page }) => {
  await login(page);
  await expect(page.locator('.mobile-navigation')).toBeVisible();
  await expect(page.getByRole('link', { name: 'ขายสินค้า' })).toHaveAttribute('aria-current', 'page');
  const columnCount = await page.locator('.sell-product-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(columnCount).toBe(2);
  await expect(page.getByText('ทีรามิสุรสช็อกโกแลตเข้มข้นพิเศษสำหรับทดสอบหน้าจอ')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await productCard(page, 'E2E Original').click();
  const cartBar = page.locator('.mobile-cart-bar');
  await expect(cartBar).toBeVisible();
  await expect(cartBar).toHaveAccessibleName(/เปิดตะกร้า 1 ชิ้น/);
  expect((await cartBar.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await cartBar.click();
  const cart = page.getByRole('dialog', { name: 'ออเดอร์ปัจจุบัน' });
  await expect(cart).toHaveClass(/is-open/);
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('sell-cart-open'))).toBe(true);
  await cart.getByLabel('เพิ่มจำนวน E2E Original').click();
  await expect(cart.getByRole('status', { name: 'จำนวน E2E Original' })).toHaveText('2');
  expect((await cart.getByLabel('เพิ่มจำนวน E2E Original').boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await page.keyboard.press('Escape');
  await expect(cartBar).toHaveAttribute('aria-expanded', 'false');
  await cartBar.click();
  await cart.getByRole('button', { name: 'ปิดตะกร้า' }).click();
  await expect(cartBar).toHaveAttribute('aria-expanded', 'false');
  await cartBar.click();
  await page.locator('.mobile-cart-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(cartBar).toHaveAttribute('aria-expanded', 'false');

  await cartBar.click();
  await cart.getByRole('button', { name: 'QR พร้อมเพย์' }).click();
  const qr = page.getByRole('dialog', { name: 'QR พร้อมเพย์' });
  await expect(qr.getByRole('img')).toBeVisible();
  await expect(qr.getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' })).toBeEnabled();
  await qr.getByRole('button', { name: 'ยกเลิก' }).click();
  await expect(cartBar).toHaveAccessibleName(/เปิดตะกร้า 2 ชิ้น/);
  await cartBar.click();
  await expect(cart.getByRole('status', { name: 'จำนวน E2E Original' })).toHaveText('2');
  await cart.getByRole('button', { name: 'ปิดตะกร้า' }).click();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('link', { name: 'จัดการสต็อก' }).click();
  await expect(page.getByRole('heading', { name: 'จัดการสต็อก' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
