import type { StockAdjustmentReason, StockSummaryItem } from '../types/stock';

const counterOf: Record<StockAdjustmentReason, { field: 'prepared' | 'giveaway' | 'waste'; sign: 1 | -1 }> = {
  prepare: { field: 'prepared', sign: 1 },
  undo_prepare: { field: 'prepared', sign: -1 },
  giveaway: { field: 'giveaway', sign: 1 },
  undo_giveaway: { field: 'giveaway', sign: -1 },
  waste: { field: 'waste', sign: 1 },
  undo_waste: { field: 'waste', sign: -1 },
};

/**
 * Applies a confirmed adjustment to one row of today's stock summary, so the
 * table can update in place instead of reloading. `stockNow` is the server's
 * answer; sell-through follows the backend's sold / prepared rule.
 */
export function applyStockAdjustment(
  item: StockSummaryItem,
  reason: StockAdjustmentReason,
  quantity: number,
  stockNow: number,
): StockSummaryItem {
  const { field, sign } = counterOf[reason];
  const next = { ...item, [field]: Math.max(0, item[field] + sign * Math.abs(quantity)), stockNow };
  return { ...next, sellThrough: next.prepared ? Math.round((next.sold / next.prepared) * 10000) / 10000 : null };
}
