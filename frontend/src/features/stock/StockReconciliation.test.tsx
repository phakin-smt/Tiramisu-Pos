import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BAANNOI_POS_DATABASE_NAME,
  openBaannoiPosDatabase,
  type OfflineOrder,
} from '../../offline/database';
import { getPendingStockReviews } from '../../offline/stockReconciliation';
import { StockReconciliationPanel } from './StockReconciliationPanel';

const tiramisu = { productId: 1, productName: 'ทีรามิสุ Original', shortfall: 2 };

async function seedReview(localOrderId: string, shortfalls = [tiramisu], createdAt = '2026-08-21T07:35:00.000Z') {
  const database = await openBaannoiPosDatabase();
  await database.put('offlineOrders', {
    localOrderId,
    localOrderNumber: `OFF-${localOrderId}`,
    createdAt,
    businessDate: '2026-08-21',
    paymentMethod: 'cash',
    customerType: 'walkin',
    subtotal: 69,
    discount: 0,
    total: 69,
    status: 'completed',
    syncStatus: 'synced',
    stockReview: true,
    stockShortfalls: shortfalls,
  } as OfflineOrder);
  database.close();
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

const reconciled = (delta: number, currentStock: number) => jsonResponse({
  productId: 1, productName: 'ทีรามิสุ Original', previousStock: currentStock - delta,
  verifiedStock: currentStock, delta, currentStock, noChange: delta === 0,
  reason: 'offline_stock_reconciliation',
});

function renderPanel(onReconciled = vi.fn(), stock = new Map([[1, 8]])) {
  render(<StockReconciliationPanel serverStock={stock} onReconciled={onReconciled} />);
  return onReconciled;
}

const verifiedInput = () => screen.getByLabelText('ตรวจนับจริง');
const confirmButton = () => screen.getByRole('button', { name: /ยืนยันปรับสต็อก|กำลังปรับ/ });
const reconcileCalls = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls
  .filter(([url]) => url === '/api/stock/reconcile');

beforeEach(async () => { await deleteDB(BAANNOI_POS_DATABASE_NAME); });
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await deleteDB(BAANNOI_POS_DATABASE_NAME);
});

describe('stock reconciliation panel', () => {
  it('renders nothing when there is no outstanding review', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderPanel();
    await vi.waitFor(async () => expect(await getPendingStockReviews()).toEqual([]));
    expect(screen.queryByText('ต้องตรวจสอบสต็อก')).not.toBeInTheDocument();
  });

  it('shows the product, server stock and the aggregated discrepancy', async () => {
    await seedReview('a', [{ ...tiramisu, shortfall: 1 }], '2026-08-21T07:31:00.000Z');
    await seedReview('b', [{ ...tiramisu, shortfall: 2 }]);
    vi.stubGlobal('fetch', vi.fn());
    renderPanel();

    const item = await screen.findByRole('listitem');
    expect(await screen.findByText('ต้องตรวจสอบสต็อก')).toBeInTheDocument();
    expect(within(item).getByText('สินค้า: ทีรามิสุ Original')).toBeInTheDocument();
    expect(within(item).getByText('2 ออเดอร์ออฟไลน์')).toBeInTheDocument();
    expect(within(item).getByText('Server stock').nextSibling).toHaveTextContent('8');
    expect(within(item).getByText('Offline sync review').nextSibling).toHaveTextContent('-3');
  });

  it('shows the delta before confirmation and blocks an empty count', async () => {
    await seedReview('a');
    vi.stubGlobal('fetch', vi.fn());
    renderPanel();
    await screen.findByRole('listitem');

    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText('Adjustment').nextSibling).toHaveTextContent('—');

    fireEvent.change(verifiedInput(), { target: { value: '5' } });
    // 5 counted against 8 on the server.
    expect(screen.getByText('Adjustment').nextSibling).toHaveTextContent('-3');
    expect(confirmButton()).toBeEnabled();
  });

  it('rejects a negative or non-numeric count without calling the API', async () => {
    await seedReview('a');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await screen.findByRole('listitem');

    for (const value of ['-1', 'abc', '2.5', ' ']) {
      fireEvent.change(verifiedInput(), { target: { value } });
      expect(confirmButton()).toBeDisabled();
    }
    expect(reconcileCalls(fetchMock)).toHaveLength(0);
    expect(await getPendingStockReviews()).toHaveLength(1);
  });

  it('sends the verified count, resolves the review, and reports the adjustment', async () => {
    await seedReview('a');
    const fetchMock = vi.fn(async () => reconciled(-3, 5));
    vi.stubGlobal('fetch', fetchMock);
    const onReconciled = renderPanel();
    await screen.findByRole('listitem');

    fireEvent.change(verifiedInput(), { target: { value: '5' } });
    fireEvent.click(confirmButton());

    expect(await screen.findByText(/ปรับสต็อก -3 ชิ้น เหลือ 5 ชิ้น/)).toBeInTheDocument();
    const [[, init]] = reconcileCalls(fetchMock);
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ productId: 1, verifiedStock: 5 });
    expect(await getPendingStockReviews()).toEqual([]);
    expect(onReconciled).toHaveBeenCalled();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('accepts a zero count and still settles the review', async () => {
    await seedReview('a');
    vi.stubGlobal('fetch', vi.fn(async () => reconciled(-8, 0)));
    renderPanel();
    await screen.findByRole('listitem');

    fireEvent.change(verifiedInput(), { target: { value: '0' } });
    fireEvent.click(confirmButton());

    expect(await screen.findByText(/ปรับสต็อก -8 ชิ้น เหลือ 0 ชิ้น/)).toBeInTheDocument();
    expect(await getPendingStockReviews()).toEqual([]);
  });

  it('does not create two adjustments under a double click', async () => {
    await seedReview('a');
    let resolveRequest!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveRequest = resolve; });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await screen.findByRole('listitem');

    fireEvent.change(verifiedInput(), { target: { value: '5' } });
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());

    expect(confirmButton()).toBeDisabled();
    expect(verifiedInput()).toBeDisabled();
    resolveRequest(reconciled(-3, 5));

    expect(await screen.findByText(/ปรับสต็อก -3 ชิ้น/)).toBeInTheDocument();
    expect(reconcileCalls(fetchMock)).toHaveLength(1);
  });

  it('keeps the typed count and the review when the API fails', async () => {
    await seedReview('a');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'ฐานข้อมูลไม่พร้อมใช้งาน' }, 500)));
    const onReconciled = renderPanel();
    await screen.findByRole('listitem');

    fireEvent.change(verifiedInput(), { target: { value: '5' } });
    fireEvent.click(confirmButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('ฐานข้อมูลไม่พร้อมใช้งาน');
    // Nothing was lost and nothing was resolved.
    expect(verifiedInput()).toHaveValue('5');
    expect(verifiedInput()).toBeEnabled();
    expect(confirmButton()).toBeEnabled();
    expect(await getPendingStockReviews()).toHaveLength(1);
    expect(onReconciled).not.toHaveBeenCalled();
  });

  it('reconciles one product at a time when several are outstanding', async () => {
    await seedReview('a', [tiramisu, { productId: 2, productName: 'Bakery', shortfall: 5 }]);
    vi.stubGlobal('fetch', vi.fn(async () => reconciled(-3, 5)));
    renderPanel(vi.fn(), new Map([[1, 8], [2, 4]]));

    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    const [bakery] = screen.getAllByRole('listitem');
    fireEvent.change(within(bakery).getByLabelText('ตรวจนับจริง'), { target: { value: '1' } });
    fireEvent.click(within(bakery).getByRole('button', { name: 'ยืนยันปรับสต็อก' }));

    await vi.waitFor(async () => expect(await getPendingStockReviews()).toHaveLength(1));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('สินค้า: ทีรามิสุ Original')).toBeInTheDocument();
  });

  it('computes the delta against server stock, not against the discrepancy', async () => {
    await seedReview('a', [{ ...tiramisu, shortfall: 2 }]);
    vi.stubGlobal('fetch', vi.fn());
    renderPanel(vi.fn(), new Map([[1, 3]]));
    await screen.findByRole('listitem');

    fireEvent.change(verifiedInput(), { target: { value: '10' } });
    // Server says 3, shelf says 10, so the correction is +7 regardless of -2.
    expect(screen.getByText('Adjustment').nextSibling).toHaveTextContent('+7');
  });
});
