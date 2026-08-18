import { expect, test } from '@playwright/test';
import { addDays, bangkokDate, expectNoHorizontalOverflow } from '../support/helpers';

test('legacy stock planning loads, validates, creates once, handles cancellation, and stays responsive', async ({ page }) => {
  await page.goto('http://127.0.0.1:8011/');
  await page.getByLabel('PIN').fill('2468');
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole('button', { name: 'Log in' }).click(),
  ]);

  let releaseInitialPlans: (() => void) | undefined;
  await page.route('**/api/stock/plans', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await new Promise<void>((resolve) => { releaseInitialPlans = resolve; });
    await route.continue();
  }, { times: 1 });

  await page.getByRole('link', { name: /จัดการสต็อก/ }).click();
  await expect(page.getByText('กำลังโหลดแผนสต็อก')).toBeVisible();
  releaseInitialPlans?.();
  await expect(page.getByText('ไม่มีแผนเตรียมสต็อกที่รอดำเนินการ')).toBeVisible();

  const form = page.locator('#stockPlanForm');
  const submit = form.getByRole('button', { name: 'เพิ่มแผน' });
  const today = await bangkokDate(page);
  const future = addDays(today, 2);
  await expect(form.locator('input[type="date"]')).toHaveValue(addDays(today, 1));
  await expect(form.locator('input[type="date"]')).toHaveAttribute('min', today);
  await form.locator('select').selectOption({ label: 'E2E Stock Item (E2E-STK)' });

  let posts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/stock/plans') && request.method() === 'POST') posts += 1;
  });
  await form.locator('input[type="number"]').fill('0');
  await submit.click();
  expect(posts).toBe(0);
  await form.locator('input[type="number"]').fill('2');
  await form.locator('input[type="date"]').fill(addDays(today, -1));
  await submit.click();
  expect(posts).toBe(0);

  await form.locator('input[type="date"]').fill(future);
  const postRequestPromise = page.waitForRequest((request) => request.url().endsWith('/api/stock/plans') && request.method() === 'POST');
  await submit.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  const postRequest = await postRequestPromise;
  await expect.poll(() => posts).toBe(1);
  expect(postRequest.postDataJSON()).toEqual({
    productId: expect.any(Number),
    date: future,
    quantity: 2,
  });
  await expect(page.locator('#stockPlanFeedback')).toHaveText('สร้างแผนเตรียมสต็อกแล้ว');
  await expect(form.locator('input[type="number"]')).toHaveValue('1');

  const plan = page.locator('.stock-plan-item').filter({ hasText: 'E2E Stock Item' });
  await expect(plan).toContainText('E2E-STK');
  await expect(plan).toContainText('รอดำเนินการ');
  await expect(plan).toContainText('2 ชิ้น');

  const refreshedUrls: string[] = [];
  page.on('request', (request) => refreshedUrls.push(new URL(request.url()).pathname));
  await page.route('**/api/stock/plans/*', async (route) => {
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'ทดสอบยกเลิกไม่สำเร็จ' }) });
  }, { times: 1 });
  page.once('dialog', (dialog) => dialog.accept());
  await plan.getByRole('button', { name: 'ยกเลิกแผน E2E Stock Item' }).click();
  await expect(page.getByRole('alert')).toContainText('ทดสอบยกเลิกไม่สำเร็จ');
  await expect(plan).toBeVisible();

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('ยกเลิกแผน E2E Stock Item');
    dialog.accept();
  });
  await plan.getByRole('button', { name: 'ยกเลิกแผน E2E Stock Item' }).click();
  await expect(page.locator('#stockPlanFeedback')).toHaveText('ยกเลิกแผนแล้ว');
  await expect(plan).toHaveCount(0);
  await expect.poll(() => refreshedUrls.filter((path) => path === '/api/stock/plans').length).toBeGreaterThan(0);
  expect(refreshedUrls).toContain('/api/stock/daily-summary');
  expect(refreshedUrls).toContain('/api/products');

  expect(await page.evaluate(() => (window as any).formatThaiDate(null))).toBe('—');
  expect(await page.evaluate(() => (window as any).formatThaiDate('not-a-date'))).toBe('not-a-date');
  expect(await page.evaluate(() => (window as any).formatThaiDate('2026-02-31'))).toBe('2026-02-31');
  expect(await page.evaluate(() => (window as any).formatThaiDate('Tue, 18 Aug 2026 00:00:00 GMT')))
    .toBe('Tue, 18 Aug 2026 00:00:00 GMT');

  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    await page.setViewportSize(viewport);
    await expect(form).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});
