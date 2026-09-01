import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../../app/router';
import { AuthProvider } from '../auth/AuthContext';
import type { CatalogProduct } from '../../types/products';
import { SellPage } from './SellPage';

const products: CatalogProduct[] = [
  { id: 1, code: 'ORI', barcode: null, name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 10, minStock: 2, active: true, icon: '🍰' },
  { id: 2, code: 'COF', barcode: '885001', name: 'Coffee', category: 'Tiramisu', price: 69, cost: 27, stock: 4, minStock: 2, active: true, icon: '☕' },
  { id: 3, code: 'CKI', barcode: null, name: 'Cookie', category: 'Bakery', price: 50, cost: 18, stock: 2, minStock: 1, active: true, icon: '🍪' },
  { id: 4, code: 'OUT', barcode: null, name: 'Sold Out', category: 'Bakery', price: 79, cost: 30, stock: 0, minStock: 1, active: true, icon: '' },
  { id: 5, code: 'OFF', barcode: null, name: 'Inactive', category: 'Bakery', price: 69, cost: 20, stock: 5, minStock: 1, active: false, icon: '' },
  { id: 6, code: 'OFF0', barcode: null, name: 'Inactive Empty', category: 'Bakery', price: 69, cost: 20, stock: 0, minStock: 1, active: false, icon: '' },
];
const summary = { date: '2026-08-17', orderCount: 3, cashTotal: 200, transferTotal: 150, totalRevenue: 350 };

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

function mockSell(handler?: (url: string, init: RequestInit) => Response | Promise<Response> | undefined) {
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const custom = handler?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url === '/api/products') return Promise.resolve(json(products));
    if (url === '/api/reports/daily-summary') return Promise.resolve(json(summary));
    if (url === '/api/cash-day') return Promise.resolve(json({ date: summary.date, openingFloat: null }));
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

function add(name: string, times = 1) {
  const button = screen.getByRole('button', { name: `เพิ่ม ${name} ลงตะกร้า` });
  for (let count = 0; count < times; count += 1) fireEvent.click(button);
}

function totalsRegion() { return screen.getByRole('region', { name: 'ยอดรวมตะกร้า' }); }

describe('SellPage', () => {
  afterEach(() => { cleanup(); document.body.classList.remove('sell-cart-open'); vi.unstubAllGlobals(); });

  it('loads the active catalog with exact product data and native keyboard controls', async () => {
    const fetchMock = mockSell();
    await renderSell();
    const original = screen.getByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    expect(original.tagName).toBe('BUTTON');
    original.focus();
    expect(original).toHaveFocus();
    expect(original).toHaveTextContent('ORI');
    expect(original).toHaveTextContent('69');
    expect(screen.getByRole('button', { name: 'เพิ่ม Inactive ลงตะกร้า' })).toBeEnabled();
    expect(screen.queryByText('Inactive Empty')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/products', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('filters products by category and exposes the selected tab state', async () => {
    mockSell(); await renderSell();
    const bakery = screen.getByRole('tab', { name: 'Bakery' });
    fireEvent.click(bakery);
    expect(bakery).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Cookie')).toBeInTheDocument();
    expect(screen.queryByText('Original')).not.toBeInTheDocument();
  });

  it('adds from the full product card and updates remaining stock immediately', async () => {
    mockSell(); await renderSell(); add('Original');
    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' })).toHaveTextContent('คงเหลือ 9 ชิ้น');
    expect(within(totalsRegion()).getByText('จำนวนทั้งหมด').parentElement).toHaveTextContent('1 ชิ้น');
  });

  it('semantically disables unavailable products and enforces the stock ceiling', async () => {
    mockSell(); await renderSell();
    expect(screen.getByRole('button', { name: 'Sold Out สินค้าหมด' })).toBeDisabled();
    add('Cookie', 3);
    expect(screen.getByLabelText('จำนวน Cookie')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Cookie สินค้าหมด' })).toBeDisabled();
    expect(screen.getByLabelText('เพิ่มจำนวน Cookie')).toBeDisabled();
  });

  it('increments, decrements, removes, and clears cart lines without invalid quantities', async () => {
    mockSell(); await renderSell(); add('Original');
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวน Original'));
    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('2');
    fireEvent.click(screen.getByLabelText('ลดจำนวน Original'));
    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('1');
    fireEvent.click(screen.getByLabelText('นำ Original ออกจากตะกร้า'));
    expect(screen.queryByLabelText('จำนวน Original')).not.toBeInTheDocument();
    add('Original'); add('Coffee');
    fireEvent.click(screen.getByRole('button', { name: 'ล้าง' }));
    expect(screen.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeInTheDocument();
  });

  it('clamps giveaways when quantity decreases and excludes them from paid quantity and subtotal', async () => {
    mockSell(); await renderSell(); add('Original', 3);
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    expect(screen.getByLabelText('จำนวนแถม Original')).toHaveTextContent('2');
    expect(within(totalsRegion()).getAllByText('1 ชิ้น')).toHaveLength(1);
    expect(totalsRegion()).toHaveTextContent('69');
    fireEvent.click(screen.getByLabelText('ลดจำนวน Original'));
    expect(screen.getByLabelText('จำนวนแถม Original')).toHaveTextContent('2');
    fireEvent.click(screen.getByLabelText('ลดจำนวน Original'));
    expect(screen.getByLabelText('จำนวนแถม Original')).toHaveTextContent('1');
  });

  it('applies the pure pooled 69-baht promotion and keeps VAT zero', async () => {
    mockSell(); await renderSell(); add('Original'); add('Coffee', 2);
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('7');
    expect(screen.getByText(/ลดให้อัตโนมัติ/)).toHaveTextContent('฿7.00');
    expect(totalsRegion()).toHaveTextContent('200');
    expect(totalsRegion()).toHaveTextContent('VAT');
    expect(totalsRegion()).toHaveTextContent('0');
  });

  it('switches to the shop wholesale rate when the customer type is ร้านค้า', async () => {
    mockSell(); await renderSell(); add('Original'); add('Coffee', 2);
    // Walk-in sees the three-for-200 promotion.
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('7');

    fireEvent.click(screen.getByRole('button', { name: 'ร้านค้า' }));

    // Three Tiramisu at 9 baht off each, and the bundle no longer applies.
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('27');
    expect(screen.getByText(/ราคาร้านค้า/)).toHaveTextContent('฿27.00');
    expect(screen.queryByText(/ลดให้อัตโนมัติ/)).not.toBeInTheDocument();
    expect(totalsRegion()).toHaveTextContent('180');

    // Switching back restores the walk-in promotion.
    fireEvent.click(screen.getByRole('button', { name: 'Walk-in' }));
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('7');
    expect(totalsRegion()).toHaveTextContent('200');
  });

  it('leaves non-Tiramisu products out of the shop rate', async () => {
    mockSell(); await renderSell(); add('Cookie', 2);
    fireEvent.click(screen.getByRole('button', { name: 'ร้านค้า' }));

    // Bakery is not discounted, so the shop note stays hidden.
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('0');
    expect(screen.queryByText(/ราคาร้านค้า/)).not.toBeInTheDocument();
    expect(totalsRegion()).toHaveTextContent('100');
  });

  it('excludes giveaways and non-69 products from promotion eligibility', async () => {
    mockSell(); await renderSell(); add('Original', 3);
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('0');
    add('Cookie', 2);
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('0');
  });

  it('applies two bundle discounts for six eligible paid units', async () => {
    mockSell(); await renderSell(); add('Original', 6);
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('14');
    expect(totalsRegion()).toHaveTextContent('400');
  });

  it('keeps a manual discount across cart changes, clamps it, and resets it on clear', async () => {
    mockSell(); await renderSell(); add('Original', 3);
    fireEvent.change(screen.getByLabelText('ส่วนลด'), { target: { value: '5' } });
    add('Original');
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('5');
    expect(screen.queryByText(/ลดให้อัตโนมัติ/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ส่วนลด'), { target: { value: '9999' } });
    expect(totalsRegion()).toHaveTextContent('฿0.00');
    fireEvent.click(screen.getByRole('button', { name: 'ล้าง' }));
    add('Original', 3);
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('7');
  });

  it('loads and collapses daily metrics from the read-only summary endpoint', async () => {
    const fetchMock = mockSell(); await renderSell();
    expect(await screen.findByText('฿350.00')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('฿200.00')).toBeInTheDocument();
    expect(screen.getByText('฿150.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนสรุป' }));
    expect(screen.queryByText('฿350.00')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/reports/daily-summary')).toHaveLength(1);
  });

  it('announces independent product and summary loading errors', async () => {
    mockSell((url) => {
      if (url === '/api/products') return json({ error: 'โหลดสินค้าไม่ได้' }, 500);
      if (url === '/api/reports/daily-summary') return json({ error: 'โหลดสรุปไม่ได้' }, 500);
      return undefined;
    });
    render(<SellPage />);
    expect(await screen.findByText('โหลดสินค้าไม่ได้')).toHaveAttribute('role', 'alert');
    expect(await screen.findByText('โหลดสรุปไม่ได้')).toHaveAttribute('role', 'alert');
  });

  it('announces the daily-summary loading state', async () => {
    const pending = new Promise<Response>(() => undefined);
    mockSell((url) => url === '/api/reports/daily-summary' ? pending : undefined);
    render(<SellPage />);
    expect(screen.getByText('กำลังโหลดสรุปยอดวันนี้')).toHaveAttribute('role', 'status');
    expect(await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' })).toBeInTheDocument();
  });

  it('routes a Sell read 401 through the existing authentication expiry flow', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/status') return Promise.resolve(json({ authenticated: true, configured: true }));
      if (url === '/api/products') return Promise.resolve(json({ error: 'หมดอายุ' }, 401));
      if (url === '/api/reports/daily-summary') return Promise.resolve(json(summary));
      if (url === '/api/cash-day') return Promise.resolve(json({ date: summary.date, openingFloat: null }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthProvider><MemoryRouter initialEntries={['/sell']}><AppRoutes /></MemoryRouter></AuthProvider>);
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Session expired');
  });

  it('clamps cart quantity and giveaways when a refreshed backend stock is lower', async () => {
    let loads = 0;
    mockSell((url) => {
      if (url !== '/api/products') return undefined;
      loads += 1;
      return json(products.map((product) => product.id === 1 ? { ...product, stock: loads === 1 ? 10 : 3 } : product));
    });
    await renderSell(); add('Original', 5);
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    fireEvent.click(screen.getByLabelText('เพิ่มจำนวนแถม Original'));
    fireEvent.click(screen.getByRole('button', { name: 'รีเฟรชสินค้า' }));
    expect(await screen.findByText('ปรับจำนวนในตะกร้าตามสต็อกล่าสุดจากระบบแล้ว')).toBeInTheDocument();
    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('3');
    expect(screen.getByLabelText('จำนวนแถม Original')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Original สินค้าหมด' })).toBeDisabled();
  });

  it('opens and dismisses the mobile cart sheet while reflecting count and total', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, media: '(max-width: 767px)', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
    mockSell(); await renderSell(); add('Original');
    const bar = screen.getByRole('button', { name: /เปิดตะกร้า 1 ชิ้น.*69/ });
    fireEvent.click(bar);
    expect(screen.getByRole('dialog', { name: 'ออเดอร์ปัจจุบัน' })).toHaveClass('is-open');
    expect(document.body).toHaveClass('sell-cart-open');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(bar).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(bar);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'ออเดอร์ปัจจุบัน' })).getByRole('button', { name: 'ปิดตะกร้า' }));
    fireEvent.click(bar);
    fireEvent.click(screen.getAllByRole('button', { name: 'ปิดตะกร้า', hidden: true }).find((button) => button.classList.contains('mobile-cart-backdrop'))!);
    expect(document.body).not.toHaveClass('sell-cart-open');
  });

  it('does not submit or request PromptPay from render, rerender, or non-payment interactions', async () => {
    const fetchMock = mockSell(); const view = await renderSell();
    add('Original');
    fireEvent.click(screen.getByRole('button', { name: 'สมาชิก' }));
    fireEvent.change(screen.getByLabelText('ส่วนลด'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'รีเฟรชสินค้า' }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/products')).toHaveLength(2));
    view.rerender(<SellPage />);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/orders'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/payment-qr'))).toBe(false);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('holds an order as an informational local action without clearing or calling an API', async () => {
    const fetchMock = mockSell();
    await renderSell();
    add('Original', 2);
    const callsBeforeHold = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'พักออเดอร์' }));
    expect(screen.getByText(/พักออเดอร์แล้ว/)).toHaveAttribute('role', 'status');
    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('2');
    expect(fetchMock.mock.calls).toHaveLength(callsBeforeHold);
  });

  it('saves the opening float without clearing the cart or submitting an order', async () => {
    const fetchMock = mockSell((url, init) => url === '/api/cash-day' && init.method === 'PUT'
      ? json({ date: summary.date, openingFloat: 500 })
      : undefined);
    await renderSell();
    add('Original');
    fireEvent.click(await screen.findByRole('button', { name: 'ตั้งเงินทอน' }));
    fireEvent.change(screen.getByLabelText('เงินทอนตั้งต้น'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await screen.findByRole('button', { name: 'แก้ไข' });

    expect(screen.getByLabelText('จำนวน Original')).toHaveTextContent('1');
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/cash-day' && (init as RequestInit).method === 'PUT')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/orders')).toBe(false);
  });
});
