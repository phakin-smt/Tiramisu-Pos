import { describe, expect, it } from 'vitest';

import type { Order } from '../types/orders';
import { applyOrderFilters, DEFAULT_ORDER_FILTERS, hasActiveOrderFilters, summarizeOrders, type OrderFilters } from './orderFilters';

function order(id: number, overrides: Partial<Order>): Order {
  return { id, orderNumber: `20260817120${id}`, time: '2026-08-17T12:00:00+07:00', paymentMethod: 'cash', subtotal: 100, discount: 0, total: 100, status: 'completed', items: [], ...overrides };
}

const orders = [
  order(1, { time: '2026-08-17T09:00:00+07:00', total: 200, items: [{ name: 'ทีรามิสุออริจินัล', code: 'ORI', qty: 3, giveawayQty: 0, unitPrice: 69, lineTotal: 200 }] }),
  order(2, { time: '2026-08-17T11:30:00+07:00', paymentMethod: 'transfer', total: 79, items: [{ name: 'Matcha', code: 'MAT', qty: 1, giveawayQty: 0, unitPrice: 79, lineTotal: 79 }] }),
  order(3, { time: '2026-08-17T10:15:00+07:00', paymentMethod: 'transfer', total: 345, status: 'cancelled' }),
  order(4, { time: '2026-08-17T13:45:00+07:00', paymentMethod: 'transfer', total: 200 }),
];
const ids = (list: Order[]) => list.map((item) => item.id);
const withFilters = (filters: Partial<OrderFilters>) => applyOrderFilters(orders, { ...DEFAULT_ORDER_FILTERS, ...filters });

describe('order filters', () => {
  it('lists oldest first by default, whatever order the orders arrive in', () => {
    expect(ids(withFilters({}))).toEqual([1, 3, 2, 4]);
  });

  it('sorts newest first and by total, breaking ties by time', () => {
    expect(ids(withFilters({ sort: 'newest' }))).toEqual([4, 2, 3, 1]);
    expect(ids(withFilters({ sort: 'highest' }))).toEqual([3, 1, 4, 2]);
    expect(ids(withFilters({ sort: 'lowest' }))).toEqual([2, 1, 4, 3]);
  });

  it('keeps only the chosen payment method and status', () => {
    expect(ids(withFilters({ payment: 'transfer' }))).toEqual([3, 2, 4]);
    expect(ids(withFilters({ payment: 'transfer', status: 'completed' }))).toEqual([2, 4]);
    expect(ids(withFilters({ status: 'cancelled' }))).toEqual([3]);
  });

  it('finds an order by number, with or without #, or by menu name and code', () => {
    expect(ids(withFilters({ query: '#202608171202' }))).toEqual([2]);
    expect(ids(withFilters({ query: ' 1204 ' }))).toEqual([4]);
    expect(ids(withFilters({ query: 'matcha' }))).toEqual([2]);
    expect(ids(withFilters({ query: 'ทีรามิสุ' }))).toEqual([1]);
    expect(ids(withFilters({ query: 'ori' }))).toEqual([1]);
    expect(withFilters({ query: 'ไม่มีเมนูนี้' })).toEqual([]);
  });

  it('does not reorder the list it was given', () => {
    const original = [...orders];
    withFilters({ sort: 'newest' });
    expect(orders).toEqual(original);
  });

  it('knows when anything is narrowing the list, but not the sort', () => {
    expect(hasActiveOrderFilters(DEFAULT_ORDER_FILTERS)).toBe(false);
    expect(hasActiveOrderFilters({ ...DEFAULT_ORDER_FILTERS, sort: 'newest' })).toBe(false);
    expect(hasActiveOrderFilters({ ...DEFAULT_ORDER_FILTERS, query: '  ' })).toBe(false);
    expect(hasActiveOrderFilters({ ...DEFAULT_ORDER_FILTERS, payment: 'cash' })).toBe(true);
  });

  it('totals only the money that actually came in', () => {
    expect(summarizeOrders(withFilters({ payment: 'transfer' }))).toEqual({ count: 3, completedCount: 2, completedTotal: 279 });
    expect(summarizeOrders([])).toEqual({ count: 0, completedCount: 0, completedTotal: 0 });
  });
});
