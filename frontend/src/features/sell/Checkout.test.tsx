import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../../app/router';
import { CHECKOUT_API_TIMEOUT_MS, REQUEST_TIMEOUT_MESSAGE } from '../../api/client';
import { ConnectivityProvider } from '../../connectivity/ConnectivityContext';
import { AuthProvider } from '../auth/AuthContext';
import { readConfirmedCatalogSnapshot, replaceConfirmedCatalogSnapshot } from '../../offline/catalogSnapshot';
import { refreshOfflineAuthorization } from '../../offline/offlineAuthorization';
import { getOfflineOrderByIdempotencyKey, getOfflineOrderDetails, getPendingOfflineOrderCount, getRecentOfflineOrders, getUnsyncedOfflineOrderCount, recordOfflineCashSale } from '../../offline/offlineOrders';
import {
  isCheckoutActive,
  queueServiceWorkerUpdate,
  resetServiceWorkerUpdateGate,
} from '../../pwa/updateGate';
import { replaceOfflinePaymentConfig } from '../../offline/paymentConfig';
import type { CatalogProduct } from '../../types/products';
import { SellPage } from './SellPage';

vi.mock('qrcode', () => ({
  default: { toString: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"/>') },
}));

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
function bodyOf(init: RequestInit) { return JSON.parse(String(init.body ?? '{}')) as { offline?: { businessDate: string; createdAt: string }; items: Array<{ productId: number; qty: number; giveawayQty: number }> }; }
function isReplay(init: RequestInit) { return Boolean(bodyOf(init).offline); }
/** Cloud checkouts only, excluding replays of sales already made offline. */
function saleCalls(fetchMock: ReturnType<typeof vi.fn>) { return orderCalls(fetchMock).filter(([, init]) => !isReplay(init as RequestInit)); }
function replayCalls(fetchMock: ReturnType<typeof vi.fn>) { return orderCalls(fetchMock).filter(([, init]) => isReplay(init as RequestInit)); }
function idempotencyKeyOf(call: unknown[]) { return ((call[1] as RequestInit).headers as Record<string, string>)['Idempotency-Key']; }
function cartTotals() { return screen.getByRole('region', { name: 'ยอดรวมตะกร้า' }); }

/** Settles only on abort, the way a checkout POST into dead air behaves. */
function neverResponds(init: RequestInit) {
  const abortError = () => new DOMException('Aborted', 'AbortError');
  if (init.signal?.aborted) return Promise.reject(abortError());
  return new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(abortError()));
  });
}

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
    // Restored centrally: a test that fails before its own restore line would
    // otherwise leave every later test believing the browser is offline.
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevokeObjectURL });
  });

  it('reuses the lost POST idempotency key for the local order written on an offline retry', async () => {
    // The server committed this order; only its response was lost. The retry
    // must therefore carry the same key so a later sync recognises the sale.
    const fetchMock = mockCheckout((url, init) => (
      url === '/api/orders' && init.method === 'POST'
        ? Promise.reject(new TypeError('network response lost'))
        : undefined
    ));
    await refreshOfflineAuthorization();
    render(<ConnectivityProvider><SellPage /></ConnectivityProvider>);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    await vi.waitFor(async () => expect(await readConfirmedCatalogSnapshot()).not.toBeNull());
    add();
    confirmCashExact();
    expect(await screen.findByRole('alert')).toHaveTextContent('network response lost');
    const sentKey = idempotencyKeyOf(orderCalls(fetchMock)[0]);
    expect(sentKey).toBeTruthy();

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    fireEvent.click(cashConfirmButton());

    expect(await screen.findByText(/บันทึกออเดอร์ออฟไลน์/)).toBeInTheDocument();
    expect(orderCalls(fetchMock)).toHaveLength(1);
    const [latest] = await getRecentOfflineOrders(1);
    expect(latest.idempotencyKey).toBe(sentKey);
    expect(await getOfflineOrderByIdempotencyKey(sentKey)).toMatchObject({ localOrderId: latest.localOrderId });
    expect(await getPendingOfflineOrderCount()).toBe(1);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  it('gives a changed cart its own local identity after a failed online attempt', async () => {
    // Same hazard on the offline half: a stale identity would make
    // recordOfflineSale return the earlier order and drop this sale.
    const fetchMock = mockCheckout((url, init) => (
      url === '/api/orders' && init.method === 'POST'
        ? Promise.reject(new TypeError('network response lost'))
        : undefined
    ));
    await refreshOfflineAuthorization();
    render(<ConnectivityProvider><SellPage /></ConnectivityProvider>);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    await vi.waitFor(async () => expect(await readConfirmedCatalogSnapshot()).not.toBeNull());
    add();
    confirmCashExact();
    expect(await screen.findByRole('alert')).toHaveTextContent('network response lost');
    const abandonedKey = idempotencyKeyOf(orderCalls(fetchMock)[0]);

    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    add(2);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    // Payment is briefly disabled while the trusted-device check resolves.
    await vi.waitFor(() => expect(cashButton()).toBeEnabled());
    confirmCashExact();

    expect(await screen.findByText(/บันทึกออเดอร์ออฟไลน์/)).toBeInTheDocument();
    const [recorded] = await getRecentOfflineOrders(1);
    expect(recorded.idempotencyKey).not.toBe(abandonedKey);
    // Priced as its own sale: three at 69 less the 7 baht bundle discount.
    expect(recorded.subtotal).toBe(207);
    expect(recorded.total).toBe(200);
    expect(await getPendingOfflineOrderCount()).toBe(1);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  it('does not write a second local order when the offline retry is double clicked', async () => {
    const fetchMock = mockCheckout((url, init) => (
      url === '/api/orders' && init.method === 'POST'
        ? Promise.reject(new TypeError('network response lost'))
        : undefined
    ));
    await refreshOfflineAuthorization();
    render(<ConnectivityProvider><SellPage /></ConnectivityProvider>);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    await vi.waitFor(async () => expect(await readConfirmedCatalogSnapshot()).not.toBeNull());
    add();
    confirmCashExact();
    expect(await screen.findByRole('alert')).toHaveTextContent('network response lost');
    const sentKey = idempotencyKeyOf(orderCalls(fetchMock)[0]);

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    fireEvent.click(cashConfirmButton());
    fireEvent.click(cashConfirmButton());

    expect(await screen.findByText(/บันทึกออเดอร์ออฟไลน์/)).toBeInTheDocument();
    expect(await getPendingOfflineOrderCount()).toBe(1);
    expect((await getRecentOfflineOrders(5)).filter((order) => order.idempotencyKey === sentKey)).toHaveLength(1);
    expect((await readConfirmedCatalogSnapshot())?.products[0].stock).toBe(9);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  it('preserves the cart and creates no local order when the order request times out', async () => {
    // Fake only the client's own timer: fake-indexeddb drives its event loop on
    // the other timer APIs and would stall if those were faked too.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const fetchMock = mockCheckout((url, init) => (
        url === '/api/orders' && init.method === 'POST' ? neverResponds(init) : undefined
      ));
      await renderCheckout();
      add(2);
      confirmCashExact();
      // The timeout is armed inside the request, so wait for it to be sent.
      await vi.waitFor(() => expect(orderCalls(fetchMock)).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(CHECKOUT_API_TIMEOUT_MS);

      expect(await screen.findByRole('alert')).toHaveTextContent(REQUEST_TIMEOUT_MESSAGE);
      // Cart intact, so the cashier can retry or fall back deliberately.
      expect(cartTotals()).toHaveTextContent('฿138.00');
      // A timeout is not permission to invent a local sale, and never retries.
      expect(await getPendingOfflineOrderCount()).toBe(0);
      expect(orderCalls(fetchMock)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses the timed-out idempotency key on a deliberate retry instead of duplicating', async () => {
    // Fake only the client's own timer: fake-indexeddb drives its event loop on
    // the other timer APIs and would stall if those were faked too.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let attempts = 0;
      const fetchMock = mockCheckout((url, init) => {
        if (url !== '/api/orders' || init.method !== 'POST') return undefined;
        attempts += 1;
        return attempts === 1 ? neverResponds(init) : json({ ...order, duplicate: true });
      });
      await renderCheckout();
      add();
      confirmCashExact();
      await vi.waitFor(() => expect(orderCalls(fetchMock)).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(CHECKOUT_API_TIMEOUT_MS);
      expect(await screen.findByRole('alert')).toHaveTextContent(REQUEST_TIMEOUT_MESSAGE);

      fireEvent.click(cashConfirmButton());
      expect(await screen.findByText(/บันทึกออเดอร์/)).toBeInTheDocument();

      const keys = orderCalls(fetchMock).map(idempotencyKeyOf);
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
      expect(await getPendingOfflineOrderCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds a waiting service worker update until the sale is finished', async () => {
    resetServiceWorkerUpdateGate();
    mockCheckout();
    await renderCheckout();
    const applyUpdate = vi.fn();

    add();
    await vi.waitFor(() => expect(isCheckoutActive()).toBe(true));
    queueServiceWorkerUpdate(applyUpdate);
    expect(applyUpdate).not.toHaveBeenCalled();

    fireEvent.click(cashButton());
    fireEvent.click(screen.getByRole('button', { name: 'Exact' }));
    expect(applyUpdate).not.toHaveBeenCalled();

    fireEvent.click(cashConfirmButton());
    expect(await screen.findByText(/บันทึกออเดอร์/)).toBeInTheDocument();
    await vi.waitFor(() => expect(applyUpdate).toHaveBeenCalledTimes(1));
  });

  it('routes one open cash confirmation locally when connectivity disappears before confirm', async () => {
    const fetchMock = mockCheckout();
    await refreshOfflineAuthorization();
    render(<ConnectivityProvider><SellPage /></ConnectivityProvider>);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    await vi.waitFor(async () => expect(await readConfirmedCatalogSnapshot()).not.toBeNull());
    add();
    fireEvent.click(cashButton());
    expect(screen.getByRole('dialog', { name: 'รับชำระเงินสด' })).toBeInTheDocument();

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Exact' }));
    fireEvent.click(cashConfirmButton());
    fireEvent.click(cashConfirmButton());

    expect(await screen.findByText(/บันทึกออเดอร์ออฟไลน์/)).toBeInTheDocument();
    expect(orderCalls(fetchMock)).toHaveLength(0);
    expect(await getPendingOfflineOrderCount()).toBe(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/payment-qr'))).toBe(false);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  it('keeps online cash in Local Mode after reconnect until pending orders are synchronized', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    await replaceConfirmedCatalogSnapshot(products, '2026-08-21T04:30:00.000Z');
    await refreshOfflineAuthorization();
    await recordOfflineCashSale({
      identity: {
        localOrderId: '550e8400-e29b-41d4-a716-446655440000',
        localOrderNumber: 'OFF-20260821-143522-0000',
        createdAt: new Date().toISOString(),
        businessDate: '2026-08-21',
      },
      order: { items: [{ productId: 1, qty: 1, giveawayQty: 0 }], paymentMethod: 'cash', customerType: 'walkin', discount: 0 },
      totals: { subtotal: 69, bundleSets: 0, autoDiscount: 0, discount: 0, vat: 0, grandTotal: 69 },
      amountTendered: 100,
      changeAmount: 31,
    });
    // The server refuses this replay outright, so the queue cannot drain and
    // Local Mode stays latched — unsynced revenue keeps owning local stock.
    const fetchMock = mockCheckout((url, init) => (
      url === '/api/orders' && init.method === 'POST' && isReplay(init)
        ? json({ error: 'สินค้าในตะกร้าหรือจำนวนแถมไม่ถูกต้อง' }, 400)
        : undefined
    ));

    render(<SellPage />);
    expect(await screen.findByText('Local Mode · รอ Sync 1 รายการ')).toBeInTheDocument();
    expect(screen.getByText('มีออเดอร์ออฟไลน์ที่ยังไม่ได้ Sync การขายจะยังบันทึกในเครื่อง')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' })).toHaveTextContent('คงเหลือ 9 ชิ้น');
    expect(transferButton()).toBeEnabled();
    await vi.waitFor(() => expect(replayCalls(fetchMock)).toHaveLength(1));

    add();
    confirmCashExact();
    expect(await screen.findByText(/บันทึกออเดอร์ออฟไลน์/)).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByText('Local Mode · รอ Sync 2 รายการ')).toBeInTheDocument());
    expect((await readConfirmedCatalogSnapshot())?.products[0].stock).toBe(8);
    expect(saleCalls(fetchMock)).toHaveLength(0);

    cleanup();
    render(<SellPage />);
    expect(await screen.findByText('Local Mode · รอ Sync 2 รายการ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' })).toHaveTextContent('คงเหลือ 8 ชิ้น');
    expect(saleCalls(fetchMock)).toHaveLength(0);
  });

  it('drains the offline queue on reconnect, releases Local Mode, and sells to the server again', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    await replaceConfirmedCatalogSnapshot(products, '2026-08-21T04:30:00.000Z');
    await refreshOfflineAuthorization();
    await recordOfflineCashSale({
      identity: {
        localOrderId: '550e8400-e29b-41d4-a716-446655440000',
        localOrderNumber: 'OFF-20260821-143522-0000',
        createdAt: '2026-08-21T07:35:22.000Z',
        businessDate: '2026-08-21',
      },
      idempotencyKey: 'aa11bb22-0000-4000-8000-00000000cccc',
      order: { items: [{ productId: 1, qty: 3, giveawayQty: 1 }], paymentMethod: 'cash', customerType: 'walkin', discount: 0 },
      totals: { subtotal: 138, bundleSets: 0, autoDiscount: 0, discount: 0, vat: 0, grandTotal: 138 },
      amountTendered: 200,
      changeAmount: 62,
    });
    const fetchMock = mockCheckout();

    render(<SellPage />);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    await vi.waitFor(() => expect(screen.queryByText(/Local Mode/)).not.toBeInTheDocument());

    const [[, replayInit]] = replayCalls(fetchMock);
    const replay = bodyOf(replayInit as RequestInit);
    expect(replay.offline).toMatchObject({ businessDate: '2026-08-21', createdAt: '2026-08-21T07:35:22.000Z' });
    // Stored qty is net of giveaways; the API expects the gross quantity.
    expect(replay.items).toEqual([{ productId: 1, qty: 3, giveawayQty: 1 }]);
    expect(((replayInit as RequestInit).headers as Record<string, string>)['Idempotency-Key'])
      .toBe('aa11bb22-0000-4000-8000-00000000cccc');
    expect(await getUnsyncedOfflineOrderCount()).toBe(0);
    expect((await getRecentOfflineOrders(1))[0]).toMatchObject({ syncStatus: 'synced', serverOrderNumber: order.orderNumber });

    // Local Mode released, so the next sale goes straight to the server.
    add();
    confirmCashExact();
    expect(await screen.findByText(/บันทึกออเดอร์ #/)).toBeInTheDocument();
    expect(saleCalls(fetchMock)).toHaveLength(1);
    expect(await getUnsyncedOfflineOrderCount()).toBe(0);
  });

  it('stops the drain and keeps the rest pending when the network dies mid-queue', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    await replaceConfirmedCatalogSnapshot(products, '2026-08-21T04:30:00.000Z');
    await refreshOfflineAuthorization();
    for (const [index, suffix] of ['1111', '2222'].entries()) {
      await recordOfflineCashSale({
        identity: {
          localOrderId: `550e8400-e29b-41d4-a716-44665544${suffix}`,
          localOrderNumber: `OFF-20260821-14352${index}-${suffix}`,
          createdAt: `2026-08-21T07:3${index}:00.000Z`,
          businessDate: '2026-08-21',
        },
        idempotencyKey: `aa11bb22-0000-4000-8000-0000000${suffix}`,
        order: { items: [{ productId: 1, qty: 1, giveawayQty: 0 }], paymentMethod: 'cash', customerType: 'walkin', discount: 0 },
        totals: { subtotal: 69, bundleSets: 0, autoDiscount: 0, discount: 0, vat: 0, grandTotal: 69 },
        amountTendered: 100,
        changeAmount: 31,
      });
    }
    let replays = 0;
    const fetchMock = mockCheckout((url, init) => {
      if (url !== '/api/orders' || init.method !== 'POST' || !isReplay(init)) return undefined;
      replays += 1;
      return replays === 1 ? json(order) : Promise.reject(new TypeError('Failed to fetch'));
    });

    render(<SellPage />);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    await vi.waitFor(() => expect(replayCalls(fetchMock)).toHaveLength(2));

    // The first is banked; the second stays pending for the next reconnect.
    await vi.waitFor(async () => expect(await getPendingOfflineOrderCount()).toBe(1));
    expect(await getUnsyncedOfflineOrderCount()).toBe(1);
    expect(await screen.findByText(/Local Mode · รอ Sync 1 รายการ/)).toBeInTheDocument();
  });

  it('creates an atomic local PromptPay sale while online Local Mode is latched by a pending order', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    await replaceConfirmedCatalogSnapshot(products, '2026-08-21T04:30:00.000Z');
    await refreshOfflineAuthorization();
    await replaceOfflinePaymentConfig('0016A00000067701011101130066801234567', 1);
    await recordOfflineCashSale({
      identity: {
        localOrderId: '550e8400-e29b-41d4-a716-446655440000',
        localOrderNumber: 'OFF-20260821-143522-0000',
        createdAt: new Date().toISOString(),
        businessDate: '2026-08-21',
      },
      order: { items: [{ productId: 1, qty: 1, giveawayQty: 0 }], paymentMethod: 'cash', customerType: 'walkin', discount: 0 },
      totals: { subtotal: 69, bundleSets: 0, autoDiscount: 0, discount: 0, vat: 0, grandTotal: 69 },
      amountTendered: 100,
      changeAmount: 31,
    });
    const fetchMock = mockCheckout((url, init) => (
      url === '/api/orders' && init.method === 'POST' && isReplay(init)
        ? json({ error: 'สินค้าในตะกร้าหรือจำนวนแถมไม่ถูกต้อง' }, 400)
        : undefined
    ));

    render(<SellPage />);
    expect(await screen.findByText('Local Mode · รอ Sync 1 รายการ')).toBeInTheDocument();
    await vi.waitFor(() => expect(replayCalls(fetchMock)).toHaveLength(1));
    add();
    fireEvent.click(transferButton());
    const modal = screen.getByRole('dialog', { name: 'QR พร้อมเพย์' });
    expect(within(modal).getByText('Local Mode · สร้าง QR ในเครื่อง')).toBeInTheDocument();
    const image = await within(modal).findByRole('img');
    expect(image).toHaveAttribute('src', 'blob:promptpay-1');
    fireEvent.load(image);
    const confirm = within(modal).getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(await screen.findByText(/บันทึกออเดอร์ออฟไลน์/)).toBeInTheDocument();
    expect(await getUnsyncedOfflineOrderCount()).toBe(2);
    expect((await readConfirmedCatalogSnapshot())?.products[0].stock).toBe(8);
    const [latest] = await getRecentOfflineOrders(1);
    expect(latest).toMatchObject({ paymentMethod: 'transfer', paymentConfirmation: 'manual', syncStatus: 'pending' });
    expect((await getOfflineOrderDetails(latest.localOrderId))?.movements).toHaveLength(1);
    expect(saleCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/payment-qr'))).toBe(false);
  });

  it('switches an open Cloud PromptPay modal to local QR and checkout when connectivity disappears', async () => {
    const qrPending = deferred<Response>();
    const fetchMock = mockCheckout((url) => url.startsWith('/api/payment-qr') ? qrPending.promise : undefined);
    await refreshOfflineAuthorization();
    await replaceOfflinePaymentConfig('0016A00000067701011101130066801234567', 1);
    render(<ConnectivityProvider><SellPage /></ConnectivityProvider>);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    await vi.waitFor(async () => expect(await readConfirmedCatalogSnapshot()).not.toBeNull());
    add();
    fireEvent.click(transferButton());
    const modal = screen.getByRole('dialog', { name: 'QR พร้อมเพย์' });
    expect(within(modal).getByText('กำลังสร้าง QR ตามยอด...')).toBeInTheDocument();

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    expect(await within(modal).findByText('Local Mode · สร้าง QR ในเครื่อง')).toBeInTheDocument();
    const image = await within(modal).findByRole('img');
    fireEvent.load(image);
    const confirm = within(modal).getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' });
    await vi.waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    expect(await screen.findByText(/บันทึกออเดอร์ออฟไลน์/)).toBeInTheDocument();
    expect(await getPendingOfflineOrderCount()).toBe(1);
    expect(orderCalls(fetchMock)).toHaveLength(0);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  it('shows actionable guidance when Local Mode has not been provisioned for PromptPay', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    await replaceConfirmedCatalogSnapshot(products, '2026-08-21T04:30:00.000Z');
    await refreshOfflineAuthorization();
    const fetchMock = mockCheckout();
    render(<ConnectivityProvider><SellPage /></ConnectivityProvider>);
    await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    add();
    fireEvent.click(transferButton());
    const modal = screen.getByRole('dialog', { name: 'QR พร้อมเพย์' });
    expect(await within(modal).findByRole('alert')).toHaveTextContent('ยังไม่ได้เตรียมพร้อมเพย์สำหรับใช้งานออฟไลน์');
    expect(within(modal).getByText('กรุณาเชื่อมต่ออินเทอร์เน็ตและเข้าสู่ระบบอย่างน้อย 1 ครั้ง')).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'ยืนยันว่าโอนแล้ว' })).toBeDisabled();
    expect(orderCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/payment-qr'))).toBe(false);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
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

    await vi.waitFor(() => expect(orderCalls(fetchMock)).toHaveLength(1));
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
    expect(await getPendingOfflineOrderCount()).toBe(0);
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
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('5');

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

  it('mints a new idempotency key when the cart changes after a failed attempt', async () => {
    // The first attempt reached the server and committed; only the response was
    // lost. The cashier then rings up a different sale. Reusing the first key
    // would make the server replay the old order and silently drop this one.
    const committed = new Map<string, { orderNumber: string; total: number }>();
    let posts = 0;
    const fetchMock = mockCheckout((url, init) => {
      if (url !== '/api/orders' || init.method !== 'POST') return undefined;
      posts += 1;
      const key = (init.headers as Record<string, string>)['Idempotency-Key'];
      const existing = committed.get(key);
      if (existing) return json({ ...order, ...existing, duplicate: true });
      const record = { orderNumber: `ORDER-${posts}`, total: bodyOf(init).items.reduce((sum, item) => sum + item.qty * 69, 0) };
      committed.set(key, record);
      // The server keeps it, but the cashier never sees the answer.
      return posts === 1 ? Promise.reject(new TypeError('network response lost')) : json({ ...order, ...record });
    });
    await renderCheckout();

    add();
    confirmCashExact();
    expect(await screen.findByRole('alert')).toHaveTextContent('network response lost');

    // A different sale entirely: three items rather than one.
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    add(2);
    confirmCashExact();

    expect(await screen.findByText(/บันทึกออเดอร์ #/)).toBeInTheDocument();
    const keys = orderCalls(fetchMock).map(idempotencyKeyOf);
    expect(keys[1]).not.toBe(keys[0]);
    // The second sale is recorded on its own terms, not replayed as the first.
    expect(await screen.findByText(/ORDER-2/)).toBeInTheDocument();
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
    await vi.waitFor(() => expect(orderCalls(fetchMock)).toHaveLength(1));
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
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('4');
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
    await vi.waitFor(() => expect(orderCalls(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(orderCalls(fetchMock)[0][1].body))).toEqual({ items: [{ productId: 1, qty: 3, giveawayQty: 1 }], paymentMethod: 'transfer', customerType: 'walkin', discount: 5 });
    expect(confirm).toBeDisabled();

    postPending.resolve(json({ ...order, paymentMethod: 'transfer', discount: 5, total: 133 }));
    expect(await screen.findByText(/บันทึกออเดอร์/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'QR พร้อมเพย์' })).not.toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeInTheDocument();
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:promptpay-1'));

    add(3);
    expect(screen.getByLabelText('จำนวนแถม Original')).toHaveTextContent('0');
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue('7');
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
    await screen.findByRole('button', { name: 'เงินสด' });
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
