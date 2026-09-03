import { expect, test } from '@playwright/test';

test('a save that takes a moment says so instead of looking ignored', async ({ page }) => {
  await page.goto('http://127.0.0.1:8011/');
  await page.getByLabel('PIN').fill('2468');
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole('button', { name: 'Log in' }).click(),
  ]);

  await page.getByRole('link', { name: /จัดการสต็อก/ }).click();
  const form = page.locator('#stockPlanForm');
  await form.locator('select').selectOption({ label: 'E2E Stock Item (E2E-STK)' });
  await form.locator('input[type="number"]').fill('2');

  // Hold the write open so the in-between state can actually be observed. This
  // is the state a cashier sees on a slow connection, and the one that used to
  // be indistinguishable from a button that did nothing.
  let release: (() => void) | undefined;
  await page.route('**/api/stock/plans', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await new Promise<void>((resolve) => { release = resolve; });
    // Abandoned rather than sent: this test is about the state between the press
    // and the answer, and the run shares one database, so it must not leave a
    // plan behind for the specs that count them. Failing also proves the banner
    // clears when a request does not succeed.
    await route.abort();
  });

  const banner = page.locator('#busyBanner');
  await expect(banner).toBeHidden();

  await form.getByRole('button', { name: 'เพิ่มแผน' }).click();
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText('กำลังบันทึก...');

  release?.();
  await expect(banner).toBeHidden();
});
