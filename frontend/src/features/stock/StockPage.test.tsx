import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StockSummaryResponse } from '../../types/stock';
import { StockPage } from './StockPage';

const stock: StockSummaryResponse = { date: '2026-08-17', items: [{ productId: 1, code: 'ORI', name: 'Original', category: 'classic', icon: '', active: true, price: 69, cost: 25, minStock: 4, stockNow: 8, prepared: 15, sold: 5, giveaway: 1, waste: 1, sellThrough: 0.4 }] };

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('StockPage', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('defaults to the Bangkok business date near UTC rollover', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T18:30:00Z'));
    const fetchMock = vi.fn().mockResolvedValue(json(stock));
    vi.stubGlobal('fetch', fetchMock);
    render(<StockPage />);
    expect(screen.getByLabelText('วันที่สต็อก')).toHaveValue('2026-08-17');
    expect(screen.getByLabelText('วันที่สต็อก')).toHaveAttribute('max', '2026-08-17');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/stock/daily-summary?date=2026-08-17', expect.anything()));
  });

  it('requests a selected date and renders all movement values without mutation controls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(stock));
    vi.stubGlobal('fetch', fetchMock);
    render(<StockPage />);
    fireEvent.change(screen.getByLabelText('วันที่สต็อก'), { target: { value: '2026-08-15' } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/stock/daily-summary?date=2026-08-15', expect.anything()));
    const row = (await screen.findByText('Original')).closest('tr');
    expect(row).toHaveTextContent('15');
    expect(row).toHaveTextContent('5');
    expect(row).toHaveTextContent('1');
    expect(row).toHaveTextContent('8');
    expect(row).toHaveTextContent('40%');
    expect(screen.getByText('อ่านอย่างเดียว')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('renders empty and API error states', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ date: '2026-08-17', items: [] })));
    render(<StockPage />);
    expect(await screen.findByText('ไม่มีข้อมูลสต็อกสำหรับวันที่เลือก')).toBeInTheDocument();
    cleanup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'โหลดสต็อกไม่ได้' }, 500)));
    render(<StockPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดสต็อกไม่ได้');
  });

  it('does not allow a stale date response to replace the latest result', async () => {
    const first = deferred<Response>();
    const latest = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.includes('date=2026-08-15') ? latest.promise : first.promise));
    render(<StockPage />);
    fireEvent.change(screen.getByLabelText('วันที่สต็อก'), { target: { value: '2026-08-15' } });
    latest.resolve(json({ date: '2026-08-15', items: [{ ...stock.items[0], name: 'Latest stock' }] }));
    expect(await screen.findByText('Latest stock')).toBeInTheDocument();
    first.resolve(json({ date: '2026-08-17', items: [{ ...stock.items[0], name: 'Stale stock' }] }));
    await Promise.resolve();
    expect(screen.queryByText('Stale stock')).not.toBeInTheDocument();
  });
});
