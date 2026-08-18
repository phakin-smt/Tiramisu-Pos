import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../../app/router';
import { AuthProvider } from '../auth/AuthContext';
import type { CatalogProduct } from '../../types/products';
import { SellPage } from './SellPage';

const products: CatalogProduct[] = [
  { id: 1, code: 'ORI', barcode: null, name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 10, minStock: 2, active: true, icon: '🍰' },
];
const summary = { date: '2026-08-17', orderCount: 3, cashTotal: 200, transferTotal: 150, totalRevenue: 350 };
const order = { orderNumber: '202608172300', subtotal: 207, discount: 7, vat: 0, total: 200, paymentMethod: 'cash' };

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

function png(): Response {
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png', 'cache-control': 'private, no-store' }), blob: async () => new Blob(['png'], { type: 'image/png' }) } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response> | undefined;

function mockCheckout(handler?: Handler) {
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const custom = handler?.(url, init);
    if (custom !== undefined) return Promise.resolve(custom);
    if (url === '/api/products') return Promise.resolve(json(products));
    if (url === '/api/reports/daily-summary') return Promise.resolve(json(summary));
    if (url === '/api/cash-day') return Promise.resolve(json({ date: summary.date, openingFloat: null }));
    if (url.startsWith('/api/payment-qr?')) return Promise.resolve(png());
    if (url === '/api/orders' && init.method === 'POST') return Promise.resolve(json(order));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderCheckout() {
  const view = render(<SellPage />);
  await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
  return view;
}

function add(times = 1) {
  const button = screen.getByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
  for (let count = 0; count < times; count += 1) fireEvent.click(button);
}

function cashButton() { return screen.getByRole('button', { name: 'เงินสด' }); }
function cashConfirmButton() { return screen.getByRole('button', { name: 'ยืนยันรับเงิน' }); }
function confirmCashExact() {
  fireEvent.click(cashButton());
  fireEvent.click(screen.getByRole('button', { name: 'Exact' }));
  fireEvent.click(cashConfirmButton());
}
function transferButton() { return screen.getByRole('button', { name: /QR พร้อมเพย์/ }); }
function orderCalls(fetchMock: ReturnType<typeof vi.fn>) { return fetchMock.mock.calls.filter(([url, init]) => url === '/api/orders' && (init as RequestInit).method === 'POST'); }

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

describe('Sell checkout', () => {
  beforeEach(() => {
    let nextUrl = 0;
    createObjectURL = vi.fn(() => `blob:promptpay-${++nextUrl}`);
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove('promptpay-open', 'sell-cart-open');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevokeObjectURL });
  });

  it('submits one exact cash payload and idempotency key under a double click', async () => {
    const pending = deferred<Response>();
    const fetchMock = mockCheckout((url, init) => url === '/api/orders' && init.method === 'POST' ? pending.promise : undefined);
    const view = await renderCheckout();
    add(3);
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    fireEvent.click(screen.getByRole('button', { name: 'สมาชิก' }));
    fireEvent.change(screen.getByLabelText('ส่วนลด'), { target: { value: '5' } });
    fireEvent.click(cashButton());
    fireEvent.click(screen.getByRole('button', { name: 'Exact' }));
    fireEvent.click(cashConfirmButton());
    fireEvent.click(cashConfirmButton());
    view.rerender(<SellPage />);

    expect(orderCalls(fetchMock)).toHaveLength(1);
    const [, init] = orderCalls(fetchMock)[0];
    expect(init.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': expect.any(String) }));
    expect(JSON.parse(String(init.body))).toEqual({
      items: [{ productId: 1, qty: 3, giveawayQty: 1 }],
      paymentMethod: 'cash',
      customerType: 'member',
      discount: 5,
    });
    expect(cashButton()).toBeDisabled();
    expect(transferButton()).toBeDisabled();

    pending.resolve(json({ ...order, discount: 5, total: 133 }));
    expect(await screen.findByText(/บันทึกออเดอร์ #202608172300/)).toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeInTheDocument();
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/products')).toHaveLength(2));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/reports/daily-summary')).toHaveLength(2);
  });

  it('preserves the key and cart state across failure and rerender, then resets the key after success', async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    vi.stubGlobal('crypto', { randomUUID });
    let posts = 0;
    const fetchMock = mockCheckout((url, init) => {
      if (url !== '/api/orders' || init.method !== 'POST') return undefined;
      posts += 1;
      return posts === 1 ? json({ error: 'บันทึกไม่สำเร็จ' }, 500) : json({ ...order, orderNumber: `ORDER-${posts}` });
    });
    const view = await renderCheckout();
    add(3);
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    fireEvent.change(screen.getByLabelText('ส่วนลด'), { target: { value: '5' } });
    confirmCashExact();
    expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกไม่สำเร็จ');
    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('3');
    expect(screen.getByLabelText('จำนวนแถม Original')).toHaveTextContent('1');
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue(5);

    view.rerender(<SellPage />);
    fireEvent.click(cashConfirmButton());
    expect(await screen.findByText(/บันทึกออเดอร์ #ORDER-2/)).toBeInTheDocument();
    const firstKey = (orderCalls(fetchMock)[0][1] as RequestInit).headers as Record<string, string>;
    const retryKey = (orderCalls(fetchMock)[1][1] as RequestInit).headers as Record<string, string>;
    expect(retryKey['Idempotency-Key']).toBe(firstKey['Idempotency-Key']);

    add();
    confirmCashExact();
    expect(await screen.findByText(/บันทึกออเดอร์ #ORDER-3/)).toBeInTheDocument();
    const nextKey = (orderCalls(fetchMock)[2][1] as RequestInit).headers as Record<string, string>;
    expect(nextKey['Idempotency-Key']).not.toBe(firstKey['Idempotency-Key']);
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it('treats an idempotent duplicate response as confirmed success after an uncertain failure', async () => {
    let posts = 0;
    const fetchMock = mockCheckout((url, init) => {
      if (url !== '/api/orders' || init.method !== 'POST') return undefined;
      posts += 1;
      return posts === 1 ? Promise.reject(new TypeError('network response lost')) : json({ ...order, duplicate: true });
    });
    await renderCheckout(); add();
    confirmCashExact();
    expect(await screen.findByRole('alert')).toHaveTextContent('network response lost');
    expect(orderCalls(fetchMock)).toHaveLength(1);
    fireEvent.click(cashConfirmButton());
    expect(await screen.findByText(/บันทึกออเดอร์/)).toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeInTheDocument();
    const keys = orderCalls(fetchMock).map(([, init]) => ((init as RequestInit).headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toEqual([keys[0], keys[0]]);
  });

  it('preserves cart, giveaway, and manual discount on stock rejection', async () => {
    mockCheckout((url, init) => url === '/api/orders' && init.method === 'POST' ? json({ error: 'Original คงเหลือไม่พอ (เหลือ 0 ชิ้น)' }, 400) : undefined);
    await renderCheckout(); add(2);
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    fireEvent.change(screen.getByLabelText('ส่วนลด'), { target: { value: '4' } });
    confirmCashExact();
    expect(await screen.findByRole('alert')).toHaveTextContent('คงเหลือไม่พอ');
    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('2');
    expect(screen.getByLabelText('จำนวนแถม Original')).toHaveTextContent('1');
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue(4);
  });

  it('keeps confirmed success even when stock and summary refreshes later fail', async () => {
    let productLoads = 0;
    let summaryLoads = 0;
    const fetchMock = mockCheckout((url) => {
      if (url === '/api/products') return ++productLoads === 1 ? json(products) : json({ error: 'โหลดสต็อกล่าสุดไม่ได้' }, 500);
      if (url === '/api/reports/daily-summary') return ++summaryLoads === 1 ? json(summary) : json({ error: 'โหลดสรุปล่าสุดไม่ได้' }, 500);
      return undefined;
    });
    await renderCheckout(); add(); confirmCashExact();
    expect(await screen.findByText(/บันทึกออเดอร์/)).toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeInTheDocument();
    expect(await screen.findByText('โหลดสต็อกล่าสุดไม่ได้')).toBeInTheDocument();
    expect(await screen.findByText('โหลดสรุปล่าสุดไม่ได้')).toBeInTheDocument();
    expect(orderCalls(fetchMock)).toHaveLength(1);
  });

  it('does not submit from render, rerender, effects, or React Strict Mode', async () => {
    const fetchMock = mockCheckout();
    const view = render(<StrictMode><SellPage /></StrictMode>);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    view.rerender(<StrictMode><SellPage /></StrictMode>);
    expect(orderCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/payment-qr'))).toBe(false);
  });

  it('loads the exact PromptPay amount without creating an order and blocks confirmation until image load', async () => {
    const qrPending = deferred<Response>();
    const fetchMock = mockCheckout((url) => url.startsWith('/api/payment-qr') ? qrPending.promise : undefined);
    await renderCheckout(); add(3); fireEvent.click(transferButton());
    const modal = screen.getByRole('dialog', { name: 'QR พร้อมเพย์' });
    expect(within(modal).getByText('กำลังสร้าง QR ตามยอด...')).toHaveAttribute('role', 'status');
    expect(within(modal).getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/payment-qr?amount=200.00', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', signal: expect.any(AbortSignal) }));
    expect(orderCalls(fetchMock)).toHaveLength(0);

    qrPending.resolve(png());
    const image = await within(modal).findByAltText('QR พร้อมเพย์ ยอด 200.00 บาท');
    expect(image).toHaveAttribute('src', 'blob:promptpay-1');
    expect(within(modal).getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' })).toBeDisabled();
    fireEvent.load(image);
    expect(within(modal).getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' })).toBeEnabled();
    expect(within(modal).getByText(/กรุณาตรวจชื่อผู้รับ/)).toBeInTheDocument();
  });

  it('submits transfer exactly once only after manual confirmation and clears all sale state', async () => {
    const postPending = deferred<Response>();
    const fetchMock = mockCheckout((url, init) => url === '/api/orders' && init.method === 'POST' ? postPending.promise : undefined);
    await renderCheckout(); add(3);
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    fireEvent.change(screen.getByLabelText('ส่วนลด'), { target: { value: '5' } });
    fireEvent.click(transferButton());
    const modal = screen.getByRole('dialog', { name: 'QR พร้อมเพย์' });
    const image = await within(modal).findByRole('img');
    fireEvent.load(image);
    const confirm = within(modal).getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(orderCalls(fetchMock)).toHaveLength(1);
    expect(JSON.parse(String(orderCalls(fetchMock)[0][1].body))).toEqual({ items: [{ productId: 1, qty: 3, giveawayQty: 1 }], paymentMethod: 'transfer', customerType: 'walkin', discount: 5 });
    expect(confirm).toBeDisabled();

    postPending.resolve(json({ ...order, paymentMethod: 'transfer', discount: 5, total: 133 }));
    expect(await screen.findByText(/บันทึกออเดอร์/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'QR พร้อมเพย์' })).not.toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeInTheDocument();
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:promptpay-1'));

    add(3);
    expect(screen.getByLabelText('จำนวนแถม Original')).toHaveTextContent('0');
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue(7);
  });

  it('blocks confirmation on QR error and preserves cart when the modal closes', async () => {
    const fetchMock = mockCheckout((url) => url.startsWith('/api/payment-qr') ? json({ error: 'ระบบพร้อมเพย์ยังไม่ได้ตั้งค่า' }, 503) : undefined);
    await renderCheckout(); add(); fireEvent.click(transferButton());
    const modal = screen.getByRole('dialog', { name: 'QR พร้อมเพย์' });
    expect(await within(modal).findByRole('alert')).toHaveTextContent('ระบบพร้อมเพย์ยังไม่ได้ตั้งค่า');
    expect(within(modal).getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' })).toBeDisabled();
    fireEvent.click(within(modal).getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('1');
    expect(orderCalls(fetchMock)).toHaveLength(0);
  });

  it('keeps the transfer retry key when a failed checkout modal is closed and reopened', async () => {
    let posts = 0;
    const fetchMock = mockCheckout((url, init) => {
      if (url !== '/api/orders' || init.method !== 'POST') return undefined;
      posts += 1;
      return posts === 1 ? json({ error: 'การเชื่อมต่อไม่แน่นอน' }, 500) : json({ ...order, paymentMethod: 'transfer', duplicate: true });
    });
    await renderCheckout(); add(); fireEvent.click(transferButton());
    let modal = screen.getByRole('dialog', { name: 'QR พร้อมเพย์' });
    fireEvent.load(await within(modal).findByRole('img'));
    fireEvent.click(within(modal).getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('การเชื่อมต่อไม่แน่นอน');
    const firstKey = ((orderCalls(fetchMock)[0][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'];
    fireEvent.click(within(modal).getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('1');

    fireEvent.click(transferButton());
    modal = screen.getByRole('dialog', { name: 'QR พร้อมเพย์' });
    fireEvent.load(await within(modal).findByRole('img'));
    fireEvent.click(within(modal).getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' }));
    expect(await screen.findByText(/บันทึกออเดอร์/)).toBeInTheDocument();
    const retryKey = ((orderCalls(fetchMock)[1][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'];
    expect(retryKey).toBe(firstKey);
  });

  it('revokes the old QR and requests a new exact amount after cart changes', async () => {
    const fetchMock = mockCheckout();
    await renderCheckout(); add(); fireEvent.click(transferButton());
    let modal = screen.getByRole('dialog', { name: 'QR พร้อมเพย์' });
    expect(await within(modal).findByRole('img')).toHaveAttribute('src', 'blob:promptpay-1');
    fireEvent.click(within(modal).getByRole('button', { name: 'ยกเลิก' }));
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:promptpay-1'));

    add(); fireEvent.click(transferButton());
    modal = screen.getByRole('dialog', { name: 'QR พร้อมเพย์' });
    expect(await within(modal).findByRole('img')).toHaveAttribute('src', 'blob:promptpay-2');
    const qrUrls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/api/payment-qr'));
    expect(qrUrls).toEqual(['/api/payment-qr?amount=69.00', '/api/payment-qr?amount=138.00']);
  });

  it('routes cash 401 through auth while preserving cart and the retry key across login', async () => {
    let posts = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/auth/status') return Promise.resolve(json({ authenticated: true, configured: true }));
      if (url === '/api/products') return Promise.resolve(json(products));
      if (url === '/api/reports/daily-summary') return Promise.resolve(json(summary));
      if (url === '/api/cash-day') return Promise.resolve(json({ date: summary.date, openingFloat: null }));
      if (url === '/api/auth/login') return Promise.resolve(json({ authenticated: true }));
      if (url === '/api/orders' && init.method === 'POST') return Promise.resolve(++posts === 1 ? json({ error: 'หมดอายุ' }, 401) : json(order));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthProvider><MemoryRouter initialEntries={['/sell']}><AppRoutes /></MemoryRouter></AuthProvider>);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    add(); confirmCashExact();
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    const firstKey = ((orderCalls(fetchMock)[0][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'];
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '2468' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByLabelText('จำนวน Original')).toHaveTextContent('1');
    confirmCashExact();
    expect(await screen.findByText(/บันทึกออเดอร์/)).toBeInTheDocument();
    const retryKey = ((orderCalls(fetchMock)[1][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'];
    expect(retryKey).toBe(firstKey);
  });

  it('routes QR 401 through auth without clearing the cart', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/status') return Promise.resolve(json({ authenticated: true, configured: true }));
      if (url === '/api/products') return Promise.resolve(json(products));
      if (url === '/api/reports/daily-summary') return Promise.resolve(json(summary));
      if (url === '/api/cash-day') return Promise.resolve(json({ date: summary.date, openingFloat: null }));
      if (url.startsWith('/api/payment-qr')) return Promise.resolve(json({ error: 'หมดอายุ' }, 401));
      if (url === '/api/auth/login') return Promise.resolve(json({ authenticated: true }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthProvider><MemoryRouter initialEntries={['/sell']}><AppRoutes /></MemoryRouter></AuthProvider>);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    add(); fireEvent.click(transferButton());
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '2468' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByLabelText('จำนวน Original')).toHaveTextContent('1');
    expect(orderCalls(fetchMock)).toHaveLength(0);
  });
});
