import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/router';
import { AuthProvider } from '../auth/AuthContext';
import type { StockPlan, StockSummaryResponse } from '../../types/stock';
import { StockPage } from './StockPage';

const TODAY = '2026-08-17';
const stock: StockSummaryResponse = { date: TODAY, items: [
  { productId: 1, code: 'ORI', name: 'Original', category: 'classic', icon: '', active: true, price: 69, cost: 25, minStock: 4, stockNow: 8, prepared: 15, sold: 5, giveaway: 1, waste: 1, sellThrough: 0.4 },
  { productId: 2, code: 'REST', name: 'Resting Stocked', category: 'classic', icon: '', active: false, price: 69, cost: 25, minStock: 4, stockNow: 3, prepared: 0, sold: 0, giveaway: 0, waste: 0, sellThrough: null },
  { productId: 3, code: 'REST0', name: 'Resting Empty', category: 'classic', icon: '', active: false, price: 69, cost: 25, minStock: 4, stockNow: 0, prepared: 0, sold: 0, giveaway: 0, waste: 0, sellThrough: null },
] };
const plan: StockPlan = { id: 9, productId: 1, date: '2026-08-20', quantity: 12, name: 'Original', code: 'ORI' };

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockStockRoutes(handler?: (url: string, init: RequestInit) => Response | Promise<Response> | undefined) {
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const custom = handler?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.startsWith('/api/stock/daily-summary')) return Promise.resolve(json({ ...stock, date: new URL(url, 'http://test').searchParams.get('date') ?? TODAY }));
    if (url === '/api/stock/plans') return Promise.resolve(json([]));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('StockPage', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-08-16T18:30:00Z')); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('defaults to the Bangkok business date and exposes current-day controls', async () => {
    const fetchMock = mockStockRoutes();
    render(<StockPage />);
    expect(screen.getByLabelText('วันที่สต็อก')).toHaveValue(TODAY);
    expect(screen.getByLabelText('วันที่สต็อก')).toHaveAttribute('max', TODAY);
    expect(await screen.findByRole('button', { name: 'เพิ่มเตรียมวันนี้ Original' })).toBeEnabled();
    expect(screen.getByLabelText('วันที่เตรียม')).toHaveAttribute('min', TODAY);
    expect(fetchMock).toHaveBeenCalledWith(`/api/stock/daily-summary?date=${TODAY}`, expect.anything());
  });

  it('shows inactive stocked products in today stock and every menu item in planning', async () => {
    mockStockRoutes();
    render(<StockPage />);

    expect(await screen.findByText('Resting Stocked')).toBeInTheDocument();
    expect(screen.queryByText('Resting Empty')).not.toBeInTheDocument();
    const selector = screen.getByLabelText('สินค้า');
    expect(selector).toHaveTextContent('Resting Stocked (REST) · พักขาย');
    expect(selector).toHaveTextContent('Resting Empty (REST0) · พักขาย');
  });

  it('renders historical movement values without any mutation controls', async () => {
    mockStockRoutes();
    render(<StockPage />);
    fireEvent.change(screen.getByLabelText('วันที่สต็อก'), { target: { value: '2026-08-15' } });
    const row = (await screen.findByText('Original')).closest('tr');
    expect(row).toHaveTextContent('15');
    expect(row).toHaveTextContent('5');
    expect(row).toHaveTextContent('40%');
    expect(screen.getByText('อ่านอย่างเดียว')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['เพิ่มเตรียมวันนี้ Original', 'prepare'],
    ['เพิ่มแถมวันนี้ Original', 'giveaway'],
    ['เพิ่มเสียวันนี้ Original', 'waste'],
  ])('submits %s once and refetches confirmed stock', async (buttonName, reason) => {
    let summaryCalls = 0;
    const fetchMock = mockStockRoutes((url, init) => {
      if (url.startsWith('/api/stock/daily-summary')) { summaryCalls += 1; return json(stock); }
      if (url === '/api/stock/adjust' && init.method === 'POST') return json({ productId: 1, stock: 9 });
    });
    render(<StockPage />);
    fireEvent.click(await screen.findByRole('button', { name: buttonName }));
    await vi.waitFor(() => expect(summaryCalls).toBe(2));
    const request = fetchMock.mock.calls.find(([url]) => url === '/api/stock/adjust');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ productId: 1, reason, quantity: 1 });
  });

  it('retains confirmed stock and shows a failed adjustment', async () => {
    mockStockRoutes((url) => url === '/api/stock/adjust' ? json({ error: 'สต็อกไม่พอ' }, 400) : undefined);
    render(<StockPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'เพิ่มแถมวันนี้ Original' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('สต็อกไม่พอ');
    expect(screen.getByText('Original').closest('tr')).toHaveTextContent('8');
  });

  it('prevents double submission while an adjustment is pending', async () => {
    const pending = deferred<Response>();
    const fetchMock = mockStockRoutes((url) => url === '/api/stock/adjust' ? pending.promise : undefined);
    render(<StockPage />);
    const button = await screen.findByRole('button', { name: 'เพิ่มเตรียมวันนี้ Original' });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/stock/adjust')).toHaveLength(1);
    expect(button).toBeDisabled();
    pending.resolve(json({ productId: 1, stock: 9 }));
    expect(await screen.findByRole('status')).toHaveTextContent('เตรียมเพิ่ม');
  });

  it('supports valid undo', async () => {
    const fetchMock = mockStockRoutes((url) => url === '/api/stock/adjust' ? json({ productId: 1, stock: 9 }) : undefined);
    render(<StockPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ลดแถมวันนี้ Original' }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/stock/adjust')).toHaveLength(1));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === '/api/stock/adjust')?.[1]?.body)).reason).toBe('undo_giveaway');
  });

  it('shows an undo rejection and preserves confirmed data', async () => {
    mockStockRoutes((url) => url === '/api/stock/adjust' ? json({ error: 'ไม่มีรายการของวันนี้ให้ยกเลิก' }, 400) : undefined);
    render(<StockPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ลดแถมวันนี้ Original' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่มีรายการของวันนี้ให้ยกเลิก');
    expect(screen.getByText('Original').closest('tr')).toHaveTextContent('8');
  });

  it('loads pending plans and can cancel one with a refresh', async () => {
    let planLoads = 0;
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = mockStockRoutes((url, init) => {
      if (url === '/api/stock/plans' && !init.method) { planLoads += 1; return json(planLoads === 1 ? [plan] : []); }
      if (url === '/api/stock/plans/9' && init.method === 'DELETE') return json({ id: 9, cancelled: true });
    });
    render(<StockPage />);
    expect(await screen.findByText('รอดำเนินการ')).toBeInTheDocument();
    expect(screen.getByText(/20.*2569/, { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิกแผน Original' }));
    await vi.waitFor(() => expect(planLoads).toBe(2));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/stock/plans/9')).toHaveLength(1);
  });

  it.each([
    'Tue, 18 Aug 2026 00:00:00 GMT',
    'not-a-date',
  ])('keeps StockPage rendered when a plan has an unexpected date: %s', async (planDate) => {
    mockStockRoutes((url) => url === '/api/stock/plans'
      ? json([{ ...plan, date: planDate }])
      : undefined);

    render(<StockPage />);

    expect(await screen.findByText(planDate, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'แผนเตรียมสต็อก' })).toBeInTheDocument();
  });

  it('creates one future plan and refreshes plans and stock', async () => {
    const pending = deferred<Response>();
    let summaryLoads = 0; let planLoads = 0;
    const fetchMock = mockStockRoutes((url, init) => {
      if (url.startsWith('/api/stock/daily-summary')) { summaryLoads += 1; return json(stock); }
      if (url === '/api/stock/plans' && init.method === 'POST') return pending.promise;
      if (url === '/api/stock/plans') { planLoads += 1; return json([]); }
    });
    render(<StockPage />);
    const submit = await screen.findByRole('button', { name: 'เพิ่มแผน' });
    await vi.waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(screen.getByLabelText('จำนวน'), { target: { value: '5' } });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/stock/plans' && init?.method === 'POST')).toHaveLength(1);
    pending.resolve(json({ id: 10 }));
    await vi.waitFor(() => { expect(summaryLoads).toBe(2); expect(planLoads).toBe(2); });
    const request = fetchMock.mock.calls.find(([url, init]) => url === '/api/stock/plans' && init?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ productId: 1, date: '2026-08-18', quantity: 5 });
  });

  it('shows an applied-plan cancellation rejection and retains the plan', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    mockStockRoutes((url, init) => {
      if (url === '/api/stock/plans' && !init.method) return json([plan]);
      if (url === '/api/stock/plans/9') return json({ error: 'แผนนี้ถูกเติมสต็อกไปแล้ว ยกเลิกไม่ได้' }, 400);
    });
    render(<StockPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิกแผน Original' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ถูกเติมสต็อกไปแล้ว');
    expect(screen.getByText('รอดำเนินการ')).toBeInTheDocument();
  });

  it('routes an adjustment 401 through auth expiry', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/auth/status') return Promise.resolve(json({ authenticated: true, configured: true }));
      if (url.startsWith('/api/stock/daily-summary')) return Promise.resolve(json(stock));
      if (url === '/api/stock/plans') return Promise.resolve(json([]));
      if (url === '/api/stock/adjust' && init.method === 'POST') return Promise.resolve(json({ error: 'หมดอายุ' }, 401));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthProvider><MemoryRouter initialEntries={['/stock']}><AppRoutes /></MemoryRouter></AuthProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'เพิ่มเตรียมวันนี้ Original' }));
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Session expired');
  });
});
