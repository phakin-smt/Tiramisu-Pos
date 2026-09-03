import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/router';
import { AuthProvider } from '../auth/AuthContext';
import type { OrdersResponse } from '../../types/orders';
import { OrdersPage } from './OrdersPage';

const STORE_LIST = { stores: [{ id: 1, code: 'baannoi', name: 'Baannoi' }], storeId: 1 };
const STORE_PRICING = {
  storeId: 1,
  bundle: { unitPrice: 69, quantity: 3, price: 200 },
  wholesale: { category: 'Tiramisu', discountPerItem: 9 },
};

const TODAY = '2026-08-17';
const orders: OrdersResponse = {
  date: TODAY,
  orders: [
    { id: 1, orderNumber: '202608171200', time: '2026-08-17T12:00:00+07:00', paymentMethod: 'cash', subtotal: 207, discount: 7, total: 200, status: 'completed', items: [{ name: 'ทีรามิสุออริจินัล', code: 'ORI', qty: 4, giveawayQty: 1, unitPrice: 69, lineTotal: 207 }] },
    { id: 2, orderNumber: '202608171215', time: '2026-08-17T12:15:00+07:00', paymentMethod: 'transfer', subtotal: 79, discount: 0, total: 79, status: 'cancelled', items: [{ name: 'Matcha', code: 'MAT', qty: 1, giveawayQty: 0, unitPrice: 79, lineTotal: 79 }] },
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

function mockOrders(handler?: (url: string, init: RequestInit) => Response | Promise<Response> | undefined) {
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const custom = handler?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.startsWith('/api/orders?date=')) return Promise.resolve(json({ ...orders, date: new URL(url, 'http://test').searchParams.get('date') ?? TODAY }));
    if (url === '/api/stores') return Promise.resolve(json(STORE_LIST));
    if (url === '/api/pricing-rules') return Promise.resolve(json(STORE_PRICING));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('OrdersPage', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-08-16T18:30:00Z')); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('defaults to Bangkok today and renders order, payment, status, and item detail', async () => {
    const fetchMock = mockOrders();
    render(<OrdersPage />);
    expect(screen.getByLabelText('วันที่ออเดอร์')).toHaveValue(TODAY);
    expect(screen.getByLabelText('วันที่ออเดอร์')).toHaveAttribute('max', TODAY);
    expect(await screen.findByText('#202608171200')).toBeInTheDocument();
    expect(screen.getByText('เงินสด')).toBeInTheDocument();
    expect(screen.getByText('โอน/พร้อมเพย์')).toBeInTheDocument();
    expect(screen.getByText('เสร็จสิ้น')).toBeInTheDocument();
    expect(screen.getByText('ยกเลิกแล้ว')).toBeInTheDocument();
    const detailButton = screen.getAllByRole('button', { name: 'ดูรายละเอียด' })[0];
    expect(detailButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(detailButton);
    expect(detailButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('ทีรามิสุออริจินัล')).toBeInTheDocument();
    const itemRow = screen.getByText('ORI').closest('tr');
    expect(itemRow).toHaveTextContent('4');
    expect(itemRow).toHaveTextContent('3');
    expect(itemRow).toHaveTextContent('แถม 1');
    expect(itemRow).toHaveTextContent('69');
    expect(itemRow).toHaveTextContent('207');
    expect(fetchMock).toHaveBeenCalledWith(`/api/orders?date=${TODAY}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('sends a selected historical date', async () => {
    const fetchMock = mockOrders();
    render(<OrdersPage />);
    fireEvent.change(screen.getByLabelText('วันที่ออเดอร์'), { target: { value: '2026-08-15' } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders?date=2026-08-15', expect.anything()));
  });

  it('renders empty and API error states', async () => {
    mockOrders(() => json({ date: TODAY, orders: [] }));
    render(<OrdersPage />);
    expect(await screen.findByText('ยังไม่มีออเดอร์ในวันที่เลือก')).toBeInTheDocument();
    cleanup();
    mockOrders(() => json({ error: 'โหลดออเดอร์ไม่ได้' }, 500));
    render(<OrdersPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดออเดอร์ไม่ได้');
  });

  it('routes an order-list 401 through auth expiry', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/status') return Promise.resolve(json({ authenticated: true, configured: true }));
      if (url.startsWith('/api/orders?date=')) return Promise.resolve(json({ error: 'หมดอายุ' }, 401));
      if (url === '/api/stores') return Promise.resolve(json(STORE_LIST));
      if (url === '/api/pricing-rules') return Promise.resolve(json(STORE_PRICING));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthProvider><MemoryRouter initialEntries={['/orders']}><AppRoutes /></MemoryRouter></AuthProvider>);
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Session expired');
  });

  it('does not allow a stale date response to replace the latest date', async () => {
    const first = deferred<Response>();
    const latest = deferred<Response>();
    mockOrders((url) => url.includes(`date=${TODAY}`) ? first.promise : latest.promise);
    render(<OrdersPage />);
    fireEvent.change(screen.getByLabelText('วันที่ออเดอร์'), { target: { value: '2026-08-15' } });
    latest.resolve(json({ date: '2026-08-15', orders: [{ ...orders.orders[0], id: 8, orderNumber: 'LATEST' }] }));
    expect(await screen.findByText('#LATEST')).toBeInTheDocument();
    first.resolve(json(orders));
    await Promise.resolve();
    expect(screen.queryByText('#202608171200')).not.toBeInTheDocument();
  });

  it('only exposes cancellation for completed orders', async () => {
    mockOrders();
    render(<OrdersPage />);
    expect(await screen.findByRole('button', { name: 'ยกเลิกออเดอร์ 202608171200' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'ยกเลิกออเดอร์ 202608171215' })).not.toBeInTheDocument();
  });

  it('requires explicit confirmation and identifies the order', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const fetchMock = mockOrders();
    render(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิกออเดอร์ 202608171200' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('#202608171200'));
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/orders/1/cancel')).toBe(false);
  });

  it('cancels through the exact endpoint and refetches backend-confirmed status', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    let loads = 0;
    const fetchMock = mockOrders((url, init) => {
      if (url.startsWith('/api/orders?date=')) { loads += 1; return json(loads === 1 ? orders : { ...orders, orders: orders.orders.map((order) => order.id === 1 ? { ...order, status: 'cancelled' } : order) }); }
      if (url === '/api/orders/1/cancel' && init.method === 'POST') return json({ id: 1, cancelled: true });
    });
    render(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิกออเดอร์ 202608171200' }));
    await vi.waitFor(() => expect(loads).toBe(2));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/orders/1/cancel')).toHaveLength(1);
    expect(fetchMock.mock.calls.find(([url]) => url === '/api/orders/1/cancel')?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(screen.queryByRole('button', { name: 'ยกเลิกออเดอร์ 202608171200' })).not.toBeInTheDocument();
    expect(screen.getAllByText('ยกเลิกแล้ว')).toHaveLength(2);
  });

  it('prevents duplicate cancellation requests while pending and across rerenders', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const pending = deferred<Response>();
    const fetchMock = mockOrders((url) => url === '/api/orders/1/cancel' ? pending.promise : undefined);
    const view = render(<OrdersPage />);
    const cancel = await screen.findByRole('button', { name: 'ยกเลิกออเดอร์ 202608171200' });
    fireEvent.click(cancel); fireEvent.click(cancel);
    view.rerender(<OrdersPage />);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/orders/1/cancel')).toHaveLength(1);
    expect(cancel).toBeDisabled();
    pending.resolve(json({ id: 1, cancelled: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('ยกเลิกออเดอร์');
  });

  it('shows backend rejection and retains the confirmed completed order', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = mockOrders((url) => url === '/api/orders/1/cancel' ? json({ error: 'ออเดอร์นี้ถูกยกเลิกไปแล้ว' }, 400) : undefined);
    render(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิกออเดอร์ 202608171200' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ออเดอร์นี้ถูกยกเลิกไปแล้ว');
    expect(screen.getByText('เสร็จสิ้น')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยกเลิกออเดอร์ 202608171200' })).toBeEnabled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/orders?date='))).toHaveLength(1);
  });

  it('keeps the newly selected date when cancellation resolves concurrently', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const cancellation = deferred<Response>();
    mockOrders((url) => {
      if (url === '/api/orders/1/cancel') return cancellation.promise;
      if (url.includes('date=2026-08-15')) return json({ date: '2026-08-15', orders: [{ ...orders.orders[1], id: 15, orderNumber: 'NEW-DATE' }] });
    });
    render(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิกออเดอร์ 202608171200' }));
    fireEvent.change(screen.getByLabelText('วันที่ออเดอร์'), { target: { value: '2026-08-15' } });
    expect(await screen.findByText('#NEW-DATE')).toBeInTheDocument();
    cancellation.resolve(json({ id: 1, cancelled: true }));
    await vi.waitFor(() => expect(screen.getByLabelText('วันที่ออเดอร์')).toHaveValue('2026-08-15'));
    expect(screen.getByText('#NEW-DATE')).toBeInTheDocument();
    expect(screen.queryByText('#202608171200')).not.toBeInTheDocument();
  });

  it('routes cancellation 401 through auth expiry', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/auth/status') return Promise.resolve(json({ authenticated: true, configured: true }));
      if (url.startsWith('/api/orders?date=')) return Promise.resolve(json(orders));
      if (url === '/api/orders/1/cancel' && init.method === 'POST') return Promise.resolve(json({ error: 'หมดอายุ' }, 401));
      if (url === '/api/stores') return Promise.resolve(json(STORE_LIST));
      if (url === '/api/pricing-rules') return Promise.resolve(json(STORE_PRICING));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthProvider><MemoryRouter initialEntries={['/orders']}><AppRoutes /></MemoryRouter></AuthProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิกออเดอร์ 202608171200' }));
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Session expired');
  });
});
