import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { AppRoutes } from '../../app/router';
import { ReportsPage } from './ReportsPage';

const days = { days: [{ date: '2026-08-16', orderCount: 2, totalRevenue: 393, closedAt: '2026-08-16T19:30:00+07:00', soldQty: 6, giveawayQty: 1, remainingQty: 8 }] };
const detail = {
  date: '2026-08-16', orderCount: 2, subtotalAll: 407, discountAll: 14, cashTotal: 200,
  transferTotal: 193, totalRevenue: 393, costTotal: 120, netProfit: 273,
  orders: [{ orderNumber: 'BB-001', time: '2026-08-16T11:15:00+07:00', paymentMethod: 'cash', subtotal: 207, discount: 7, total: 200, items: [{ name: 'Original', code: 'ORI', qty: 3, giveawayQty: 1, unitPrice: 69, lineTotal: 138 }] }],
  menuSummary: [{ code: 'ORI', name: 'Original', category: 'classic', icon: '', active: true, sold: 5, giveaway: 1, waste: 2, remaining: 8 }],
};

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

describe('ReportsPage', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('loads days, selects one, and renders the exact report data without mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(days)).mockResolvedValueOnce(json(detail));
    vi.stubGlobal('fetch', fetchMock);
    render(<ReportsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /16.*2569/ }));
    expect(await screen.findByText('Original')).toBeInTheDocument();
    expect(screen.getByText(/Original × 3/)).toHaveTextContent('แถม 1');
    expect(screen.getByText('ยอดขายรวม').parentElement).toHaveTextContent('393');
    expect(screen.getAllByText('เงินสด')[0].parentElement).toHaveTextContent('200');
    expect(screen.getByText('เงินโอน').parentElement).toHaveTextContent('193');
    expect(screen.getByText('ส่วนลดรวม').parentElement).toHaveTextContent('14');
    expect(screen.getByText('ต้นทุนรวม').parentElement).toHaveTextContent('120');
    expect(screen.getByText('กำไรขั้นต้น').parentElement).toHaveTextContent('273');
    expect(screen.getByRole('heading', { name: 'ความเคลื่อนไหวสินค้า' })).toBeInTheDocument();
    expect(screen.getByText('ORI · classic').closest('tr')).toHaveTextContent('ORI · classic5128');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/reports/close-day?date=2026-08-16', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('renders empty day and empty selected-report states', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ days: [] })));
    render(<ReportsPage />);
    expect(await screen.findByText('ยังไม่มีข้อมูลการขาย')).toBeInTheDocument();
    expect(screen.getByText('เลือกวันที่เพื่อดูรายละเอียดรายงาน')).toBeInTheDocument();
  });

  it('renders an available day with an empty report without inventing data', async () => {
    const emptyDetail = { ...detail, orderCount: 0, subtotalAll: 0, discountAll: 0, cashTotal: 0, transferTotal: 0, totalRevenue: 0, costTotal: 0, netProfit: 0, orders: [], menuSummary: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(days)).mockResolvedValueOnce(json(emptyDetail)));
    render(<ReportsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /16.*2569/ }));
    expect(await screen.findByText('ไม่มีออเดอร์ในวันที่เลือก')).toBeInTheDocument();
    expect(screen.getByText('ไม่มีความเคลื่อนไหวของสินค้าในวันที่เลือก')).toBeInTheDocument();
    expect(screen.getByText('ยอดขายรวม').parentElement).toHaveTextContent('0');
  });

  it('shows API errors without crashing the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'โหลดรายงานไม่ได้' }, 500)));
    render(<ReportsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายงานไม่ได้');
    expect(screen.getByRole('heading', { name: 'รายงาน' })).toBeInTheDocument();
  });

  it('routes a report 401 through the existing session-expiry behavior', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ authenticated: true, configured: true })).mockResolvedValueOnce(json({ error: 'หมดอายุ' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthProvider><MemoryRouter initialEntries={['/reports']}><AppRoutes /></MemoryRouter></AuthProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired');
    expect(screen.getByLabelText('PIN')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});
