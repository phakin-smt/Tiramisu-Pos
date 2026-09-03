import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockSummaryResponse } from '../../types/stock';
import { ProductsAdminPage } from './ProductsAdminPage';

const STORE_LIST = { stores: [{ id: 1, code: 'baannoi', name: 'Baannoi' }], storeId: 1 };
const STORE_PRICING = {
  storeId: 1,
  bundle: { unitPrice: 69, quantity: 3, price: 200 },
  wholesale: { category: 'Tiramisu', discountPerItem: 9 },
};

const summary: StockSummaryResponse = {
  date: '2026-08-17',
  items: [
    { productId: 1, code: 'ORI', name: 'Original', category: 'Tiramisu', icon: '', active: true, price: 69, cost: 25, minStock: 4, stockNow: 8, prepared: 3, sold: 1, giveaway: 0, waste: 0, sellThrough: 0.3333 },
    { productId: 2, code: 'MAT', name: 'Matcha', category: 'Tiramisu', icon: '', active: false, price: 79, cost: 30, minStock: 2, stockNow: 5, prepared: 0, sold: 0, giveaway: 0, waste: 0, sellThrough: null },
  ],
};

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockProducts(handler?: (url: string, init: RequestInit) => Response | Promise<Response> | undefined) {
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const custom = handler?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.startsWith('/api/stock/daily-summary')) return Promise.resolve(json(summary));
    if (url === '/api/stores') return Promise.resolve(json(STORE_LIST));
    if (url === '/api/pricing-rules') return Promise.resolve(json(STORE_PRICING));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fillCreateForm() {
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('รหัสเมนู'), { target: { value: 'COC' } });
  fireEvent.change(dialog.getByLabelText('ชื่อเมนู'), { target: { value: 'Cocoa' } });
  fireEvent.change(dialog.getByLabelText('หมวดหมู่'), { target: { value: 'Tiramisu' } });
  fireEvent.change(dialog.getByLabelText('ราคาขาย (บาท)'), { target: { value: '89' } });
}

describe('ProductsAdminPage', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-08-16T18:30:00Z')); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('lists active and inactive products and filters by search and status', async () => {
    mockProducts();
    render(<ProductsAdminPage />);
    expect(await screen.findByText('Original')).toBeInTheDocument();
    expect(screen.getByText('Matcha')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ค้นหาเมนู'), { target: { value: 'mat' } });
    expect(screen.queryByText('Original')).not.toBeInTheDocument();
    expect(screen.getByText('Matcha')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ค้นหาเมนู'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('สถานะ'), { target: { value: 'active' } });
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.queryByText('Matcha')).not.toBeInTheDocument();
  });

  it('creates a product with the exact backend payload and refreshes the list', async () => {
    let loads = 0;
    const fetchMock = mockProducts((url, init) => {
      if (url.startsWith('/api/stock/daily-summary')) { loads += 1; return json(summary); }
      if (url === '/api/products' && init.method === 'POST') return json({ id: 3, code: 'COC' });
    });
    render(<ProductsAdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มเมนูใหม่/ }));
    fillCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกเมนู' }));
    expect(await screen.findByRole('status')).toHaveTextContent('เพิ่มเมนูใหม่แล้ว');
    await vi.waitFor(() => expect(loads).toBe(2));
    const request = fetchMock.mock.calls.find(([url]) => url === '/api/products');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ code: 'COC', name: 'Cocoa', category: 'Tiramisu', price: 89, cost: 0, stock: 0, minStock: 2, active: true });
  });

  it('edits a product and includes direct stock replacement exactly', async () => {
    const fetchMock = mockProducts((url, init) => url === '/api/products/1' && init.method === 'PUT' ? json({ id: 1, code: 'ORI' }) : undefined);
    render(<ProductsAdminPage />);
    await screen.findByText('Original');
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไข Original' }));
    fireEvent.change(screen.getByLabelText('จำนวนคงเหลือ'), { target: { value: '13' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกเมนู' }));
    expect(await screen.findByRole('status')).toHaveTextContent('แก้ไขเมนูแล้ว');
    const request = fetchMock.mock.calls.find(([url]) => url === '/api/products/1');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ code: 'ORI', name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 13, minStock: 4, active: true });
  });

  it.each([
    ['เปิดขาย Original', 1, false],
    ['เปิดขาย Matcha', 2, true],
  ])('toggles %s through the active endpoint', async (accessibleName, id, active) => {
    const fetchMock = mockProducts((url) => url === `/api/products/${id}/active` ? json({ id, active }) : undefined);
    render(<ProductsAdminPage />);
    fireEvent.click(await screen.findByRole('checkbox', { name: accessibleName }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === `/api/products/${id}/active`)).toBe(true));
    const request = fetchMock.mock.calls.find(([url]) => url === `/api/products/${id}/active`);
    expect(request?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ active });
  });

  it('confirms deletion and handles the backend deleted response without assuming hard versus soft delete', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = mockProducts((url, init) => url === '/api/products/1' && init.method === 'DELETE' ? json({ id: 1, deleted: true }) : undefined);
    render(<ProductsAdminPage />);
    await screen.findByText('Original');
    fireEvent.click(screen.getByRole('button', { name: 'ลบ Original' }));
    expect(await screen.findByRole('status')).toHaveTextContent('ลบเมนูแล้ว');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/products/1')).toHaveLength(1);
  });

  it('shows client validation and backend errors while retaining confirmed data', async () => {
    mockProducts((url) => url === '/api/products/1/active' ? json({ error: 'เปลี่ยนสถานะไม่ได้' }, 400) : undefined);
    render(<ProductsAdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มเมนูใหม่/ }));
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('กรอกรหัสเมนู');
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'เปิดขาย Original' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('เปลี่ยนสถานะไม่ได้');
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'เปิดขาย Original' })).toBeChecked();
  });

  it('prevents a double create request while pending', async () => {
    const pending = deferred<Response>();
    const fetchMock = mockProducts((url) => url === '/api/products' ? pending.promise : undefined);
    const view = render(<ProductsAdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มเมนูใหม่/ }));
    fillCreateForm();
    const submit = screen.getByRole('button', { name: 'บันทึกเมนู' });
    fireEvent.click(submit); fireEvent.click(submit);
    view.rerender(<ProductsAdminPage />);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/products')).toHaveLength(1);
    expect(submit).toBeDisabled();
    pending.resolve(json({ id: 3, code: 'COC' }));
    expect(await screen.findByRole('status')).toHaveTextContent('เพิ่มเมนูใหม่แล้ว');
  });
});
