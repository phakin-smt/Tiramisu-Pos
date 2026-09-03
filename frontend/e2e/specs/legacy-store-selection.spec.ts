import { expect, test } from '@playwright/test';

async function loginToLegacyApp(page: import('@playwright/test').Page) {
  await page.goto('http://127.0.0.1:8011/');
  await page.getByLabel('PIN').fill('2468');
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole('button', { name: 'Log in' }).click(),
  ]);
}

test('one store is not a question, so the till opens straight onto the menu', async ({ page }) => {
  await loginToLegacyApp(page);

  // Nothing to choose between, so nothing is asked.
  await expect(page.locator('#storeOverlay')).toBeHidden();
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' })).toBeVisible();

  // The shop being rung up for is named, and there is nowhere else to switch to.
  await expect(page.locator('#storeNameText')).toHaveText('Baannoi');
  await expect(page.locator('#storeSwitchButton')).toBeHidden();
});

test('the promotion the till applies is the one the server holds for this store', async ({ page }) => {
  await loginToLegacyApp(page);

  const original = page.getByRole('button', { name: 'เพิ่ม E2E Original ลงตะกร้า' });
  await original.click();
  await original.click();
  await original.click();

  // 69 x 3 becomes 200 because that is this store's rule, now fetched rather
  // than compiled in. A store without it would charge the full 207.
  await expect(page.locator('#discountInput')).toHaveValue('7');
  await expect(page.locator('#grandTotalValue')).toHaveText(/200\.00/);
  await expect(page.locator('#promoHint')).toContainText('ครบ 3 ชิ้น');
});
