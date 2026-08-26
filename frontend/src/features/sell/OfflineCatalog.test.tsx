import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectivityProvider } from '../../connectivity/ConnectivityContext';
import { replaceConfirmedCatalogSnapshot } from '../../offline/catalogSnapshot';
import { refreshOfflineAuthorization } from '../../offline/offlineAuthorization';
import { getOfflineOrderDetails, getPendingOfflineOrderCount, getRecentOfflineOrders } from '../../offline/offlineOrders';
import type { CatalogProduct } from '../../types/products';
import { SellPage } from './SellPage';

const cachedProducts: CatalogProduct[] = [
  { id: 1, code: 'ORI', barcode: null, name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 10, minStock: 2, active: true, icon: '🍰' },
  { id: 2, code: 'COF', barcode: null, name: 'Coffee', category: 'Tiramisu', price: 69, cost: 27, stock: 4, minStock: 2, active: true, icon: '☕' },
  { id: 3, code: 'OFF', barcode: null, name: 'Inactive Stocked', category: 'Bakery', price: 50, cost: 18, stock: 2, minStock: 1, active: false, icon: '🍪' },
  { id: 4, code: 'OFF0', barcode: null, name: 'Inactive Empty', category: 'Bakery', price: 79, cost: 30, stock: 0, minStock: 1, active: false, icon: '' },
];

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

function renderOfflineSell() {
  return render(
    <ConnectivityProvider>
      <SellPage />
    </ConnectivityProvider>,
  );
}

describe('SellPage offline catalog', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setNavigatorOnline(true);
  });

  it('shows the honest first-run state without requesting products when no snapshot exists', async () => {
    setNavigatorOnline(false);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);

    renderOfflineSell();

    expect(await screen.findByText('ยังไม่มีข้อมูลสำหรับใช้งานออฟไลน์')).toBeInTheDocument();
    expect(screen.getByText('กรุณาเชื่อมต่ออินเทอร์เน็ตและเปิดหน้าขายอย่างน้อย 1 ครั้ง')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/products')).toBe(false);
    expect(screen.queryByRole('button', { name: /เพิ่ม .* ลงตะกร้า/ })).not.toBeInTheDocument();
  });

  it('uses cached categories and stock while blocking every checkout path without authorization', async () => {
    await replaceConfirmedCatalogSnapshot(cachedProducts, '2026-08-21T04:30:00.000Z');
    setNavigatorOnline(false);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);

    renderOfflineSell();

    expect(await screen.findByText('ใช้ข้อมูลออฟไลน์ล่าสุด')).toBeInTheDocument();
    expect(screen.getByText(/อัปเดตล่าสุด.*21.*ส\.ค\..*11:30/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tiramisu' })).toBeInTheDocument();
    const bakery = screen.getByRole('tab', { name: 'Bakery' });
    fireEvent.click(bakery);
    expect(screen.getByRole('button', { name: 'เพิ่ม Inactive Stocked ลงตะกร้า' })).toBeEnabled();
    expect(screen.queryByText('Inactive Empty')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Tiramisu' }));
    const addOriginal = screen.getByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    fireEvent.click(addOriginal);
    fireEvent.click(addOriginal);
    fireEvent.click(addOriginal);
    expect(screen.getByLabelText('ส่วนลด')).toHaveValue(7);
    expect(within(screen.getByRole('region', { name: 'ยอดรวมตะกร้า' })).getByText('฿200.00')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'เงินสด' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'QR พร้อมเพย์' })).toBeDisabled();
    expect(screen.getByText('อุปกรณ์นี้ยังไม่พร้อมสำหรับการขายออฟไลน์ กรุณาเชื่อมต่ออินเทอร์เน็ตและเข้าสู่ระบบก่อนใช้งาน')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'เงินสด' }));
    fireEvent.click(screen.getByRole('button', { name: 'QR พร้อมเพย์' }));

    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/orders' && (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/payment-qr'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/products')).toBe(false);
  });

  it('completes an authorized offline cash sale without order or QR requests and reloads reduced stock', async () => {
    await replaceConfirmedCatalogSnapshot(cachedProducts, '2026-08-21T04:30:00.000Z');
    await refreshOfflineAuthorization();
    setNavigatorOnline(false);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);

    renderOfflineSell();
    const addOriginal = await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    fireEvent.click(addOriginal);
    fireEvent.click(addOriginal);
    fireEvent.click(addOriginal);
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มจำนวนแถม Original' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'เงินสด' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'เงินสด' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exact' }));
    const confirm = screen.getByRole('button', { name: 'ยืนยันรับเงิน' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(await screen.findByText(/บันทึกออเดอร์ออฟไลน์ #OFF-.*แล้ว · ยังไม่ได้ Sync/)).toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' })).toHaveTextContent('คงเหลือ 7 ชิ้น'));
    expect(await getPendingOfflineOrderCount()).toBe(1);
    const [order] = await getRecentOfflineOrders(1);
    const details = await getOfflineOrderDetails(order.localOrderId);
    expect(details?.items[0]).toMatchObject({ qty: 2, giveawayQty: 1, unitPrice: 69, paidLineSubtotal: 138 });
    expect(details?.movements).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/orders' && (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/payment-qr'))).toBe(false);
  });
});
