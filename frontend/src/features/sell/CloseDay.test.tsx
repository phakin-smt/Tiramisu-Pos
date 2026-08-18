import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../../app/router';
import type { CatalogProduct } from '../../types/products';
import { AuthProvider } from '../auth/AuthContext';
import { SellPage } from './SellPage';

const products: CatalogProduct[] = [
  { id: 1, code: 'ORI', barcode: null, name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 10, minStock: 2, active: true, icon: '🍰' },
];
const summary = { date: '2026-08-17', orderCount: 2, cashTotal: 200, transferTotal: 193, totalRevenue: 393 };
const report = {
  date: '2026-08-17', orderCount: 2, subtotalAll: 407, discountAll: 14, cashTotal: 200,
  transferTotal: 193, totalRevenue: 393, costTotal: 120, netProfit: 273,
  openingFloat: 1260, expectedCash: 1460,
  orders: [{ orderNumber: 'BB-001', time: '2026-08-17T11:15:00+07:00', paymentMethod: 'cash', subtotal: 207, discount: 7, total: 200, items: [{ name: 'Original', code: 'ORI', qty: 3, giveawayQty: 1, unitPrice: 69, lineTotal: 138 }] }],
  menuSummary: [{ code: 'ORI', name: 'Original', category: 'Tiramisu', icon: '', active: true, sold: 5, giveaway: 1, waste: 2, remaining: 8 }],
};
const openDays = { days: [{ date: '2026-08-17', orderCount: 2, totalRevenue: 393, closedAt: null, soldQty: 5, giveawayQty: 1, remainingQty: 8 }] };
const closedDays = { days: [{ ...openDays.days[0], closedAt: '2026-08-17T19:30:00+07:00' }] };
const closure = { date: '2026-08-17', closedAt: '2026-08-17T20:45:00+07:00' };
const order = { orderNumber: 'ORDER-2', subtotal: 69, discount: 0, vat: 0, total: 69, paymentMethod: 'cash' };

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response> | undefined;

function mockCloseDay(handler?: FetchHandler) {
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const custom = handler?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url === '/api/products') return Promise.resolve(json(products));
    if (url === '/api/reports/daily-summary') return Promise.resolve(json(summary));
    if (url === '/api/cash-day') return Promise.resolve(json({ date: summary.date, openingFloat: null }));
    if (url === '/api/reports/close-day' && init.method === 'POST') return Promise.resolve(json(closure));
    if (url === '/api/reports/close-day') return Promise.resolve(json(report));
    if (url === '/api/reports/days') return Promise.resolve(json(openDays));
    if (url === '/api/orders' && init.method === 'POST') return Promise.resolve(json(order));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderSell() {
  const view = render(<SellPage />);
  await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
  return view;
}

async function openPreview() {
  fireEvent.click(screen.getByRole('button', { name: 'สรุป / ปิดยอดวันนี้' }));
  return screen.findByRole('dialog', { name: 'สรุปและปิดยอดวันนี้' });
}

function closeDayPosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url, init]) => url === '/api/reports/close-day' && (init as RequestInit | undefined)?.method === 'POST');
}

function orderPosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url, init]) => url === '/api/orders' && (init as RequestInit | undefined)?.method === 'POST');
}

describe('Sell close-day workflow', () => {
  afterEach(() => {
    cleanup();
    document.body.classList.remove('close-day-open', 'promptpay-open', 'sell-cart-open');
    vi.unstubAllGlobals();
  });

  it('loads the preview only after explicit action and renders backend report totals without posting', async () => {
    const fetchMock = mockCloseDay();
    await renderSell();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/reports/close-day')).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'สรุปและปิดยอดวันนี้' })).not.toBeInTheDocument();

    const modal = await openPreview();
    expect(within(modal).getByText('ยอดขายรวม').parentElement).toHaveTextContent('393');
    expect(within(modal).getAllByText('เงินสด')[0].parentElement).toHaveTextContent('200');
    expect(within(modal).getByText('เงินโอน').parentElement).toHaveTextContent('193');
    expect(within(modal).getByText('ส่วนลดรวม').parentElement).toHaveTextContent('14');
    expect(within(modal).getByText('ต้นทุนรวม').parentElement).toHaveTextContent('120');
    expect(within(modal).getByText('กำไรขั้นต้น').parentElement).toHaveTextContent('273');
    expect(within(modal).getByText('เงินทอนตั้งต้น').parentElement).toHaveTextContent('1,260');
    expect(within(modal).getAllByText('เงินสดที่ควรมี').find((element) => element.tagName === 'DT')?.parentElement).toHaveTextContent('1,460');
    expect(within(modal).getByText('ORI · Tiramisu').closest('tr')).toHaveTextContent('5128');
    expect(within(modal).queryByText('เตรียม')).not.toBeInTheDocument();
    expect(closeDayPosts(fetchMock)).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/close-day', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/days', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('marks expected cash as unavailable when the opening float is unset', async () => {
    mockCloseDay((url, init) => url === '/api/reports/close-day' && init.method !== 'POST'
      ? json({ ...report, openingFloat: null, expectedCash: null })
      : undefined);
    await renderSell();
    const modal = await openPreview();
    expect(within(modal).getByText('ยังไม่ได้ตั้งเงินทอน')).toBeInTheDocument();
    expect(within(modal).queryByText('฿0.00')).not.toBeInTheDocument();
  });

  it('explains the marker semantics and allows an already-closed day to be re-closed', async () => {
    const fetchMock = mockCloseDay((url, init) => url === '/api/reports/days' && init.method !== 'POST' ? json(closedDays) : undefined);
    await renderSell();
    const modal = await openPreview();
    expect(within(modal).getByText(/ปิดยอดล่าสุด 19:30/)).toBeInTheDocument();
    expect(within(modal).getByText(/ยังรับออเดอร์เพิ่มหลังจากนี้ได้/)).toBeInTheDocument();
    expect(within(modal).queryByText(/ห้ามขาย|ขายต่อไม่ได้|ไม่สามารถรับออเดอร์/)).not.toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'อัปเดตเวลาปิดยอด' }));
    expect(await within(modal).findByText(/บันทึกเวลาปิดยอดแล้ว 20:45/)).toBeInTheDocument();
    expect(closeDayPosts(fetchMock)).toHaveLength(1);
  });

  it('shows a preview failure without opening a report or sending a POST', async () => {
    const fetchMock = mockCloseDay((url, init) => url === '/api/reports/close-day' && init.method !== 'POST' ? json({ error: 'โหลดสรุปวันนี้ไม่ได้' }, 500) : undefined);
    await renderSell();
    fireEvent.click(screen.getByRole('button', { name: 'สรุป / ปิดยอดวันนี้' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดสรุปวันนี้ไม่ได้');
    expect(screen.queryByRole('dialog', { name: 'สรุปและปิดยอดวันนี้' })).not.toBeInTheDocument();
    expect(closeDayPosts(fetchMock)).toHaveLength(0);
  });

  it('routes a preview 401 through the existing session-expiry flow', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/status') return Promise.resolve(json({ authenticated: true, configured: true }));
      if (url === '/api/products') return Promise.resolve(json(products));
      if (url === '/api/reports/daily-summary') return Promise.resolve(json(summary));
      if (url === '/api/cash-day') return Promise.resolve(json({ date: summary.date, openingFloat: null }));
      if (url === '/api/reports/close-day') return Promise.resolve(json({ error: 'หมดอายุ' }, 401));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthProvider><MemoryRouter initialEntries={['/sell']}><AppRoutes /></MemoryRouter></AuthProvider>);
    await screen.findByRole('button', { name: 'สรุป / ปิดยอดวันนี้' });
    fireEvent.click(screen.getByRole('button', { name: 'สรุป / ปิดยอดวันนี้' }));
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.getByText('Session expired. Please log in again.')).toBeInTheDocument();
  });

  it('requires confirmation, locks a double click to one POST, and refreshes confirmed data', async () => {
    const post = deferred<Response>();
    const fetchMock = mockCloseDay((url, init) => url === '/api/reports/close-day' && init.method === 'POST' ? post.promise : undefined);
    await renderSell();
    const modal = await openPreview();
    expect(closeDayPosts(fetchMock)).toHaveLength(0);
    const confirm = within(modal).getByRole('button', { name: 'ยืนยันปิดยอดวันนี้' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(closeDayPosts(fetchMock)).toHaveLength(1);
    expect(confirm).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(modal).toBeInTheDocument();
    post.resolve(json(closure));

    expect(await within(modal).findByText(/บันทึกเวลาปิดยอดแล้ว 20:45/)).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/reports/daily-summary')).toHaveLength(2);
      expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/reports/close-day' && (init as RequestInit | undefined)?.method !== 'POST')).toHaveLength(2);
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/reports/days')).toHaveLength(2);
    });
  });

  it('never posts from render, rerender, or Strict Mode and still submits once after confirmation', async () => {
    const fetchMock = mockCloseDay();
    const view = render(<StrictMode><SellPage /></StrictMode>);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    view.rerender(<StrictMode><SellPage /></StrictMode>);
    expect(closeDayPosts(fetchMock)).toHaveLength(0);
    const modal = await openPreview();
    expect(closeDayPosts(fetchMock)).toHaveLength(0);
    fireEvent.click(within(modal).getByRole('button', { name: 'ยืนยันปิดยอดวันนี้' }));
    expect(await within(modal).findByText(/บันทึกเวลาปิดยอดแล้ว 20:45/)).toBeInTheDocument();
    expect(closeDayPosts(fetchMock)).toHaveLength(1);
  });

  it('keeps the preview visible and shows the backend error after a failed POST', async () => {
    const fetchMock = mockCloseDay((url, init) => url === '/api/reports/close-day' && init.method === 'POST' ? json({ error: 'บันทึกเวลาปิดยอดไม่ได้' }, 500) : undefined);
    await renderSell();
    const modal = await openPreview();
    fireEvent.click(within(modal).getByRole('button', { name: 'ยืนยันปิดยอดวันนี้' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('บันทึกเวลาปิดยอดไม่ได้');
    expect(modal).toBeInTheDocument();
    expect(within(modal).queryByText(/บันทึกเวลาปิดยอดแล้ว/)).not.toBeInTheDocument();
    expect(closeDayPosts(fetchMock)).toHaveLength(1);
  });

  it('routes a close-day mutation 401 through authentication expiry', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/auth/status') return Promise.resolve(json({ authenticated: true, configured: true }));
      if (url === '/api/products') return Promise.resolve(json(products));
      if (url === '/api/reports/daily-summary') return Promise.resolve(json(summary));
      if (url === '/api/cash-day') return Promise.resolve(json({ date: summary.date, openingFloat: null }));
      if (url === '/api/reports/close-day' && init.method === 'POST') return Promise.resolve(json({ error: 'หมดอายุ' }, 401));
      if (url === '/api/reports/close-day') return Promise.resolve(json(report));
      if (url === '/api/reports/days') return Promise.resolve(json(openDays));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthProvider><MemoryRouter initialEntries={['/sell']}><AppRoutes /></MemoryRouter></AuthProvider>);
    await screen.findByRole('button', { name: 'สรุป / ปิดยอดวันนี้' });
    const modal = await openPreview();
    fireEvent.click(within(modal).getByRole('button', { name: 'ยืนยันปิดยอดวันนี้' }));
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(closeDayPosts(fetchMock)).toHaveLength(1);
  });

  it('keeps backend-confirmed success when later report refreshes fail', async () => {
    let closeGets = 0;
    let dayGets = 0;
    const fetchMock = mockCloseDay((url, init) => {
      if (url === '/api/reports/close-day' && init.method !== 'POST') return ++closeGets === 1 ? json(report) : json({ error: 'รีเฟรชรายงานไม่ได้' }, 500);
      if (url === '/api/reports/days') return ++dayGets === 1 ? json(openDays) : json({ error: 'รีเฟรชวันไม่ได้' }, 500);
      return undefined;
    });
    await renderSell();
    const modal = await openPreview();
    fireEvent.click(within(modal).getByRole('button', { name: 'ยืนยันปิดยอดวันนี้' }));
    expect(await within(modal).findByText(/บันทึกเวลาปิดยอดแล้ว 20:45/)).toBeInTheDocument();
    await waitFor(() => expect(dayGets).toBe(2));
    expect(within(modal).queryByRole('alert')).not.toBeInTheDocument();
    expect(closeDayPosts(fetchMock)).toHaveLength(1);
  });

  it('does not clear the cart or reset a pending checkout idempotency key', async () => {
    let checkoutAttempts = 0;
    const fetchMock = mockCloseDay((url, init) => {
      if (url === '/api/orders' && init.method === 'POST') {
        checkoutAttempts += 1;
        return checkoutAttempts === 1 ? json({ error: 'ผลการบันทึกไม่แน่นอน' }, 500) : json({ ...order, duplicate: true });
      }
      return undefined;
    });
    await renderSell();
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' }));
    fireEvent.click(screen.getByRole('button', { name: 'เงินสด' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exact' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันรับเงิน' }));
    expect(await screen.findByText('ผลการบันทึกไม่แน่นอน')).toBeInTheDocument();
    const firstKey = (((orderPosts(fetchMock)[0][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key']);
    fireEvent.click(screen.getByRole('button', { name: 'ปิดรับชำระเงินสด' }));

    const modal = await openPreview();
    fireEvent.click(within(modal).getByRole('button', { name: 'ยืนยันปิดยอดวันนี้' }));
    await within(modal).findByText(/บันทึกเวลาปิดยอดแล้ว/);
    fireEvent.click(within(modal).getByRole('button', { name: 'กลับไปขาย' }));
    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'เงินสด' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exact' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันรับเงิน' }));
    expect(await screen.findByText(/บันทึกออเดอร์ #ORDER-2/)).toBeInTheDocument();
    const retryKey = (((orderPosts(fetchMock)[1][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key']);
    expect(retryKey).toBe(firstKey);
  });

  it('moves focus into the modal and supports Escape and backdrop dismissal', async () => {
    mockCloseDay();
    await renderSell();
    let modal = await openPreview();
    expect(within(modal).getByRole('button', { name: 'กลับไปขาย' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'สรุปและปิดยอดวันนี้' })).not.toBeInTheDocument();

    modal = await openPreview();
    fireEvent.mouseDown(modal.parentElement as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'สรุปและปิดยอดวันนี้' })).not.toBeInTheDocument();
  });
});
