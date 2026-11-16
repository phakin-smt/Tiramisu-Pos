import type { Order } from '../types/orders';

export type OrderPaymentFilter = 'all' | 'cash' | 'transfer';
export type OrderStatusFilter = 'all' | 'completed' | 'cancelled';
export type OrderSort = 'oldest' | 'newest' | 'highest' | 'lowest';

export interface OrderFilters {
  query: string;
  payment: OrderPaymentFilter;
  status: OrderStatusFilter;
  sort: OrderSort;
}

/** Oldest first is the order the API returns, so the default view is unchanged. */
export const DEFAULT_ORDER_FILTERS: OrderFilters = { query: '', payment: 'all', status: 'all', sort: 'oldest' };

export function hasActiveOrderFilters(filters: OrderFilters): boolean {
  return filters.query.trim() !== '' || filters.payment !== 'all' || filters.status !== 'all';
}

function matchesQuery(order: Order, query: string): boolean {
  // Staff read the number off a screen with its # in front, so accept it typed that way.
  const needle = query.trim().replace(/^#/, '').toLocaleLowerCase('th');
  if (!needle) return true;
  if (order.orderNumber.toLocaleLowerCase('th').includes(needle)) return true;
  return order.items.some((item) => item.name.toLocaleLowerCase('th').includes(needle) || item.code.toLocaleLowerCase('th').includes(needle));
}

function timeOf(order: Order): number {
  const parsed = Date.parse(order.time);
  return Number.isNaN(parsed) ? 0 : parsed;
}

const comparators: Record<OrderSort, (a: Order, b: Order) => number> = {
  oldest: (a, b) => timeOf(a) - timeOf(b) || a.id - b.id,
  newest: (a, b) => timeOf(b) - timeOf(a) || b.id - a.id,
  // Equal totals fall back to time, so the list does not reshuffle between loads.
  highest: (a, b) => b.total - a.total || timeOf(a) - timeOf(b) || a.id - b.id,
  lowest: (a, b) => a.total - b.total || timeOf(a) - timeOf(b) || a.id - b.id,
};

export function applyOrderFilters(orders: Order[], filters: OrderFilters): Order[] {
  return orders
    .filter((order) => filters.payment === 'all' || order.paymentMethod === filters.payment)
    .filter((order) => filters.status === 'all' || order.status === filters.status)
    .filter((order) => matchesQuery(order, filters.query))
    .sort(comparators[filters.sort]);
}

export interface OrderSummary {
  count: number;
  /** Completed orders only: a cancelled order brought in no money. */
  completedCount: number;
  completedTotal: number;
}

export function summarizeOrders(orders: Order[]): OrderSummary {
  const completed = orders.filter((order) => order.status === 'completed');
  return {
    count: orders.length,
    completedCount: completed.length,
    completedTotal: completed.reduce((sum, order) => sum + order.total, 0),
  };
}
