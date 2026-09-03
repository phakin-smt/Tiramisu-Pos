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
import {
  getUnsyncedOfflineOrders,
  retryFailedOfflineOrder,
} from '../../offline/offlineOrders';
import { OfflineOrderQueuePanel } from './OfflineOrderQueuePanel';

async function seedOrder(overrides: Partial<OfflineOrder> & { localOrderId: string }) {
  const database = await openBaannoiPosDatabase();
  await database.put('offlineOrders', {
    localOrderNumber: `OFF-20260828-103522-${overrides.localOrderId.slice(-4).toUpperCase()}`,
    createdAt: '2026-08-28T03:35:22.000Z',
    businessDate: '2026-08-28',
    paymentMethod: 'cash',
    customerType: 'walkin',
    subtotal: 207,
    discount: 0,
    total: 207,
    status: 'completed',
    syncStatus: 'pending',
    idempotencyKey: `key-${overrides.localOrderId}`,
    ...overrides,
  } as OfflineOrder);
  database.close();
}

async function readOrder(localOrderId: string) {
  const database = await openBaannoiPosDatabase();
  try {
    return await database.get('offlineOrders', localOrderId);
  } finally {
    database.close();
  }
}

function renderQueue(onRetry = vi.fn(async () => {}), overrides: Partial<Parameters<typeof OfflineOrderQueuePanel>[0]> = {}) {
  render(<OfflineOrderQueuePanel storeId={1} revision={0} syncing={false} canRetry onRetry={onRetry} {...overrides} />);
  return onRetry;
}

beforeEach(async () => { await deleteDB(BAANNOI_POS_DATABASE_NAME); });
afterEach(async () => {
  cleanup();
  await deleteDB(BAANNOI_POS_DATABASE_NAME);
});

describe('unsynced offline order queue', () => {
  it('renders nothing when every order is synced', async () => {
    await seedOrder({ localOrderId: 'a3f1', syncStatus: 'synced' });
    renderQueue();
    await vi.waitFor(async () => expect((await getUnsyncedOfflineOrders(1))).toHaveLength(0));
    expect(screen.queryByText('ออเดอร์ที่ยังไม่ได้ Sync')).not.toBeInTheDocument();
  });

  it('shows the order number, time, total, payment method and pending state', async () => {
    await seedOrder({ localOrderId: 'a3f1' });
    renderQueue();

    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('OFF-20260828-103522-A3F1')).toBeInTheDocument();
    expect(within(item).getByText('฿207.00')).toBeInTheDocument();
    expect(within(item).getByText('เงินสด')).toBeInTheDocument();
    expect(within(item).getByText('รอ Sync')).toBeInTheDocument();
    expect(screen.getByText(/รอ Sync 1 รายการ/)).toBeInTheDocument();
    // Nothing to retry while it is merely waiting.
    expect(within(item).queryByRole('button')).not.toBeInTheDocument();
  });

  it('counts pending and failed separately and surfaces the failure reason', async () => {
    await seedOrder({ localOrderId: 'a3f1' });
    await seedOrder({ localOrderId: 'b4e2', createdAt: '2026-08-28T03:36:00.000Z', syncStatus: 'failed', syncError: 'สินค้าในตะกร้าไม่ถูกต้อง', paymentMethod: 'transfer', total: 138 });
    renderQueue();

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByText(/รอ Sync 1 รายการ · Sync ไม่สำเร็จ 1 รายการ/)).toBeInTheDocument();
    expect(within(items[1]).getByRole('alert')).toHaveTextContent('สินค้าในตะกร้าไม่ถูกต้อง');
    expect(within(items[1]).getByText('PromptPay')).toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: 'ลองอีกครั้ง' })).toBeEnabled();
  });

  it('flags an order that still needs a stock review', async () => {
    await seedOrder({ localOrderId: 'a3f1', syncStatus: 'failed', syncError: 'ล้มเหลว', stockReview: true });
    renderQueue();

    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('ต้องตรวจสอบสต็อก')).toBeInTheDocument();
  });

  it('requeues a failed order without changing anything that identifies it', async () => {
    await seedOrder({ localOrderId: 'a3f1', syncStatus: 'failed', syncError: 'ล้มเหลว' });
    const before = await readOrder('a3f1');
    const onRetry = renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'ลองอีกครั้ง' }));
    await vi.waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));

    const after = await readOrder('a3f1');
    expect(after?.syncStatus).toBe('pending');
    expect(after?.syncError).toBeUndefined();
    // Identity, key, timestamps, payment and totals all survive the retry.
    expect(after).toMatchObject({
      localOrderId: before!.localOrderId,
      localOrderNumber: before!.localOrderNumber,
      idempotencyKey: before!.idempotencyKey,
      createdAt: before!.createdAt,
      businessDate: before!.businessDate,
      paymentMethod: before!.paymentMethod,
      total: before!.total,
      subtotal: before!.subtotal,
    });
  });

  it('does not requeue twice under a double click', async () => {
    await seedOrder({ localOrderId: 'a3f1', syncStatus: 'failed', syncError: 'ล้มเหลว' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const onRetry = vi.fn(async () => { await gate; });
    renderQueue(onRetry);

    const button = await screen.findByRole('button', { name: 'ลองอีกครั้ง' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(await screen.findByRole('button', { name: 'กำลัง Sync...' })).toBeDisabled();
    release();
    await vi.waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });

  it('disables retry while a sync is already running or the backend is unreachable', async () => {
    await seedOrder({ localOrderId: 'a3f1', syncStatus: 'failed', syncError: 'ล้มเหลว' });
    const { unmount } = render(<OfflineOrderQueuePanel storeId={1} revision={0} syncing canRetry onRetry={vi.fn(async () => {})} />);
    expect(await screen.findByRole('button', { name: 'กำลัง Sync...' })).toBeDisabled();
    unmount();

    render(<OfflineOrderQueuePanel storeId={1} revision={0} syncing={false} canRetry={false} onRetry={vi.fn(async () => {})} />);
    expect(await screen.findByRole('button', { name: 'ลองอีกครั้ง' })).toBeDisabled();
  });
});

describe('retryFailedOfflineOrder', () => {
  it('only requeues an order that actually failed', async () => {
    await seedOrder({ localOrderId: 'a3f1', syncStatus: 'synced', serverOrderNumber: '202608280001' });

    const result = await retryFailedOfflineOrder('a3f1');

    // A synced order must never be pushed back into the queue.
    expect(result?.syncStatus).toBe('synced');
    expect((await readOrder('a3f1'))?.syncStatus).toBe('synced');
  });

  it('returns null for an order that does not exist', async () => {
    expect(await retryFailedOfflineOrder('missing')).toBeNull();
  });

  it('is idempotent when called twice on the same failed order', async () => {
    await seedOrder({ localOrderId: 'a3f1', syncStatus: 'failed', syncError: 'ล้มเหลว' });

    await retryFailedOfflineOrder('a3f1');
    await retryFailedOfflineOrder('a3f1');

    const order = await readOrder('a3f1');
    expect(order?.syncStatus).toBe('pending');
    expect(order?.idempotencyKey).toBe('key-a3f1');
    const database = await openBaannoiPosDatabase();
    expect(await database.count('offlineOrders')).toBe(1);
    database.close();
  });
});
