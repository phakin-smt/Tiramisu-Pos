import { expect, test, type Page } from '@playwright/test';
import { productCard } from '../support/helpers';

const STORE_BUTTON = '[data-customer-type="store"]';
const WALKIN_BUTTON = '[data-customer-type="walkin"]';

async function loginToLegacyApp(page: Page) {
  await page.goto('http://127.0.0.1:8011/');
  await page.getByLabel('PIN').fill('2468');
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole('button', { name: 'Log in' }).click(),
  ]);
}

test('a shop customer is charged the wholesale rate instead of the three-for-200 promotion', async ({ page }) => {
  await loginToLegacyApp(page);

  const subtotal = page.locator('#subtotalValue');
  const total = page.locator('#grandTotalValue');
  const discount = page.locator('#discountInput');
  const hint = page.locator('#promoHint');

  // Three Tiramisu at 69: the quantity the bundle promotion is built around.
  for (let index = 0; index < 3; index += 1) {
    await productCard(page, 'E2E Original').click();
  }

  await expect(subtotal).toHaveText(/207\.00/);
  await expect(discount).toHaveValue('7');
  await expect(total).toHaveText(/200\.00/);
  await expect(hint).toContainText('โปรฯ ครบ 3 ชิ้น');

  // Switching customer type has to reprice the cart on the spot: the cashier
  // reads the total off this screen before taking the money.
  await page.locator(STORE_BUTTON).click();

  // 9 baht off each of the three pieces, and the bundle no longer applies.
  await expect(subtotal).toHaveText(/207\.00/);
  await expect(discount).toHaveValue('27');
  await expect(total).toHaveText(/180\.00/);
  await expect(hint).toContainText('ราคาส่งร้านค้า');

  await page.locator(WALKIN_BUTTON).click();
  await expect(discount).toHaveValue('7');
  await expect(total).toHaveText(/200\.00/);
  await expect(hint).toContainText('โปรฯ ครบ 3 ชิ้น');
});

test('the wholesale rate follows the Tiramisu category rather than the 69 baht price', async ({ page }) => {
  await loginToLegacyApp(page);
  await page.locator(STORE_BUTTON).click();

  const discount = page.locator('#discountInput');
  const total = page.locator('#grandTotalValue');

  // A Tiramisu priced at 89 still earns the wholesale rate.
  await productCard(page, 'ทีรามิสุรสช็อกโกแลตเข้มข้นพิเศษสำหรับทดสอบหน้าจอ').click();
  await expect(discount).toHaveValue('9');
  await expect(total).toHaveText(/80\.00/);

  // A product outside the category adds nothing to the discount.
  await productCard(page, 'E2E Stock Item').click();
  await expect(discount).toHaveValue('9');
  await expect(total).toHaveText(/130\.00/);
});

test('a manually typed discount still overrides the wholesale rate', async ({ page }) => {
  await loginToLegacyApp(page);
  await page.locator(STORE_BUTTON).click();

  const discount = page.locator('#discountInput');
  const total = page.locator('#grandTotalValue');

  await productCard(page, 'E2E Original').click();
  await expect(discount).toHaveValue('9');

  await discount.fill('20');
  await expect(total).toHaveText(/49\.00/);
  await expect(page.locator('#promoHint')).toBeHidden();
});
