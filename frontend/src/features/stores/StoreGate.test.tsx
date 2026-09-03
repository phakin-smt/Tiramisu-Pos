import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SellPage } from '../sell/SellPage';
import { StoreProvider, useStore } from './StoreContext';
import { StoreGate } from './StoreGate';

const DESSERT_RULES = {
  storeId: 1,
  bundle: { unitPrice: 69, quantity: 3, price: 200 },
  wholesale: { category: 'Tiramisu', discountPerItem: 9 },
};
const PASTA_RULES = { storeId: 2, bundle: null, wholesale: null };

const dessertProducts = [
  { id: 1, code: 'ORI', barcode: null, name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 10, minStock: 2, active: true, icon: '🍰' },
];
const pastaProducts = [
  { id: 9, code: 'CAR', barcode: null, name: 'Carbonara', category: 'Pasta', price: 69, cost: 30, stock: 8, minStock: 2, active: true, icon: '🍝' },
];

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

/** A deployment with two stores, where the session has not chosen one yet. */
function mockTwoStores(initialStoreId: number | null) {
  let storeId = initialStoreId;
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url === '/api/stores') {
      return Promise.resolve(json({
        stores: [{ id: 1, code: 'baannoi', name: 'Baannoi' }, { id: 2, code: 'pasta', name: 'Pasta House' }],
        storeId,
      }));
    }
    if (url === '/api/auth/select-store') {
      storeId = JSON.parse(String(init.body)).storeId;
      return Promise.resolve(json({ storeId }));
    }
    if (url === '/api/pricing-rules') return Promise.resolve(json(storeId === 2 ? PASTA_RULES : DESSERT_RULES));
    if (url === '/api/products') return Promise.resolve(json(storeId === 2 ? pastaProducts : dessertProducts));
    if (url === '/api/reports/daily-summary') {
      return Promise.resolve(json({ date: '2026-09-03', orderCount: 0, cashTotal: 0, transferTotal: 0, totalRevenue: 0 }));
    }
    if (url === '/api/cash-day') return Promise.resolve(json({ date: '2026-09-03', openingFloat: null }));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function SwitchButton() {
  const { requestSwitch } = useStore();
  return <button type="button" onClick={requestSwitch}>เปลี่ยนร้าน</button>;
}

function renderTill() {
  return render(
    <StoreProvider>
      <SwitchButton />
      <StoreGate>
        <SellPage />
      </StoreGate>
    </StoreProvider>,
  );
}

describe('store selection', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('asks which store to sell for before opening the till', async () => {
    mockTwoStores(null);
    renderTill();

    expect(await screen.findByRole('heading', { name: 'เลือกร้านที่จะขาย' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Baannoi/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pasta House/ })).toBeInTheDocument();
    // Nothing sellable is on screen until the question is answered.
    expect(screen.queryByRole('heading', { name: 'ขายสินค้า' })).not.toBeInTheDocument();
  });

  it('opens the till for the chosen store', async () => {
    mockTwoStores(null);
    renderTill();

    fireEvent.click(await screen.findByRole('button', { name: /Pasta House/ }));

    expect(await screen.findByRole('button', { name: 'เพิ่ม Carbonara ลงตะกร้า' })).toBeInTheDocument();
    expect(screen.queryByText('Original')).not.toBeInTheDocument();
  });

  it('prices each store by its own rules rather than the other shop\'s', async () => {
    mockTwoStores(1);
    renderTill();

    const addOriginal = await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' });
    fireEvent.click(addOriginal);
    fireEvent.click(addOriginal);
    fireEvent.click(addOriginal);
    // Three at 69 is the dessert shop's bundle: 207 becomes 200.
    await waitFor(() => expect(screen.getByLabelText('ส่วนลด')).toHaveValue('7'));

    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนร้าน' }));
    fireEvent.click(await screen.findByRole('button', { name: /Pasta House/ }));

    const addPasta = await screen.findByRole('button', { name: 'เพิ่ม Carbonara ลงตะกร้า' });
    fireEvent.click(addPasta);
    fireEvent.click(addPasta);
    fireEvent.click(addPasta);
    // Same price, same quantity, but this shop was never given that promotion.
    await waitFor(() => expect(screen.getByLabelText('ส่วนลด')).toHaveValue('0'));
  });

  it('does not carry a cart across the switch', async () => {
    mockTwoStores(1);
    renderTill();

    fireEvent.click(await screen.findByRole('button', { name: 'เพิ่ม Original ลงตะกร้า' }));
    await waitFor(() => expect(screen.queryByText('ยังไม่มีสินค้าในตะกร้า')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนร้าน' }));
    fireEvent.click(await screen.findByRole('button', { name: /Pasta House/ }));

    await screen.findByRole('button', { name: 'เพิ่ม Carbonara ลงตะกร้า' });
    // The dessert shop's cart must not follow the cashier into the other shop.
    expect(screen.getByText('ยังไม่มีสินค้าในตะกร้า')).toBeInTheDocument();
  });
});
