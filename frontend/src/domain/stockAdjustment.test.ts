import { describe, expect, it } from 'vitest';

import type { StockSummaryItem } from '../types/stock';
import { applyStockAdjustment } from './stockAdjustment';

const item: StockSummaryItem = {
  productId: 1, code: 'ORI', name: 'Original', category: 'classic', icon: '', imageUrl: null, active: true,
  price: 69, cost: 25, minStock: 4, stockNow: 8, prepared: 15, sold: 5, giveaway: 1, waste: 1, sellThrough: 0.3333,
};

describe('applyStockAdjustment', () => {
  it('adds preparation and recomputes sell-through', () => {
    expect(applyStockAdjustment(item, 'prepare', 5, 13)).toMatchObject({ prepared: 20, stockNow: 13, sellThrough: 0.25 });
  });

  it('moves only the counter the reason names', () => {
    expect(applyStockAdjustment(item, 'giveaway', 2, 6)).toMatchObject({ prepared: 15, giveaway: 3, waste: 1, stockNow: 6 });
    expect(applyStockAdjustment(item, 'undo_waste', 1, 9)).toMatchObject({ giveaway: 1, waste: 0, stockNow: 9 });
  });

  it('clears sell-through when nothing is prepared', () => {
    expect(applyStockAdjustment({ ...item, prepared: 2 }, 'undo_prepare', 2, 6)).toMatchObject({ prepared: 0, sellThrough: null });
  });
});
