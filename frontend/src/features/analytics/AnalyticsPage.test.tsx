import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsResponse } from '../../types/analytics';
import { AnalyticsPage } from './AnalyticsPage';

const analytics: AnalyticsResponse = {
  startDate: '2026-08-10', endDate: '2026-08-16',
  overview: { revenue: 1400, orderCount: 7, averageTicket: 200, discount: 49, cost: 500, grossProfit: 900 },
  daily: [{ date: '2026-08-16', orderCount: 2, revenue: 400 }],
  topProducts: [{ productId: 1, name: 'Original', code: 'ORI', soldQty: 10, revenue: 690 }],
  losses: [{ productId: 2, name: 'Matcha', code: 'MAT', giveawayQty: 2, wasteQty: 1 }],
  lowStock: [{ productId: 3, name: 'Cocoa', code: 'COC', stock: 2, minStock: 5 }],
};

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('AnalyticsPage', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('uses seven days by default and renders every supplied analytics section', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(analytics));
    vi.stubGlobal('fetch', fetchMock);
    render(<AnalyticsPage />);
    expect(await screen.findByText('Original')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 วัน' })).toHaveAttribute('aria-pressed', 'true');
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics?days=7', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getAllByText('ยอดขาย')[0].parentElement).toHaveTextContent('1,400');
    expect(screen.getByText('ยอดเฉลี่ยต่อออเดอร์').parentElement).toHaveTextContent('200');
    expect(screen.getByText('Matcha')).toBeInTheDocument();
    expect(screen.getByText('แถม 2 · เสีย 1')).toBeInTheDocument();
    expect(screen.getByText('Cocoa')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'ข้อมูลยอดขายรายวัน' })).toBeInTheDocument();
  });

  it('requests each supported range and exposes semantic selection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(analytics));
    vi.stubGlobal('fetch', fetchMock);
    render(<AnalyticsPage />);
    await screen.findByText('Original');
    fireEvent.click(screen.getByRole('button', { name: '1 วัน' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/analytics?days=1', expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: '30 วัน' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/analytics?days=30', expect.anything()));
    expect(screen.getByRole('button', { name: '30 วัน' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders empty and error states', async () => {
    const empty = { ...analytics, daily: [], topProducts: [], losses: [], lowStock: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(empty)));
    render(<AnalyticsPage />);
    expect(await screen.findByText('ไม่มีข้อมูลยอดขายในช่วงเวลานี้')).toBeInTheDocument();
    expect(screen.getByText('ไม่มีข้อมูลสินค้าขายดี')).toBeInTheDocument();
    cleanup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'วิเคราะห์ไม่ได้' }, 500)));
    render(<AnalyticsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('วิเคราะห์ไม่ได้');
  });

  it('does not allow a stale range response to replace the latest result', async () => {
    const seven = deferred<Response>();
    const thirty = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.endsWith('days=7') ? seven.promise : thirty.promise));
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: '30 วัน' }));
    thirty.resolve(json({ ...analytics, topProducts: [{ ...analytics.topProducts[0], name: 'Latest product' }] }));
    expect(await screen.findByText('Latest product')).toBeInTheDocument();
    seven.resolve(json({ ...analytics, topProducts: [{ ...analytics.topProducts[0], name: 'Stale product' }] }));
    await Promise.resolve();
    expect(screen.queryByText('Stale product')).not.toBeInTheDocument();
  });

  describe('custom range', () => {
    // 2026-08-16 in Bangkok. Only Date is faked, so fetch promises still settle.
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-08-16T05:00:00Z')); });
    afterEach(() => { vi.useRealTimers(); });

    it('requests a chosen date range and labels its length', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        const params = new URL(url, 'http://test').searchParams;
        return json({ ...analytics, startDate: params.get('start') ?? analytics.startDate, endDate: params.get('end') ?? analytics.endDate });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<AnalyticsPage />);
      await screen.findByText('Original');

      fireEvent.click(screen.getByRole('button', { name: 'กำหนดเอง' }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/analytics?start=2026-08-10&end=2026-08-16', expect.anything()));
      expect(screen.getByRole('button', { name: 'กำหนดเอง' })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.change(screen.getByLabelText('ตั้งแต่'), { target: { value: '2026-08-01' } });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/analytics?start=2026-08-01&end=2026-08-16', expect.anything()));
      expect(await screen.findByText('ช่วงที่เลือก 16 วัน')).toBeInTheDocument();
      expect(screen.getByLabelText('ถึง')).toHaveAttribute('max', '2026-08-16');
    });

    it('explains an invalid range and does not request it', async () => {
      const fetchMock = vi.fn().mockResolvedValue(json(analytics));
      vi.stubGlobal('fetch', fetchMock);
      render(<AnalyticsPage />);
      await screen.findByText('Original');
      fireEvent.click(screen.getByRole('button', { name: 'กำหนดเอง' }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      fireEvent.change(screen.getByLabelText('ตั้งแต่'), { target: { value: '2026-08-20' } });
      expect(screen.getByRole('alert')).toHaveTextContent('วันเริ่มต้องไม่เกินวันสิ้นสุด');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
