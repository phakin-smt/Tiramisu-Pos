import { describe, expect, it } from 'vitest';

import {
  calculateTotals,
  resetManualDiscount,
  setManualDiscount,
} from './promotion';
import type { PricingLine } from '../types/domain';

const eligibleLine = (quantity: number, giveawayQuantity = 0): PricingLine => ({
  unitPrice: 69,
  quantity,
  giveawayQuantity,
});

describe('current bundle promotion', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 7],
    [4, 7],
    [5, 7],
    [6, 14],
  ])('discounts %i eligible units by %i baht', (quantity, discount) => {
    expect(calculateTotals([eligibleLine(quantity)]).discount).toBe(discount);
  });

  it('pools eligible quantities across different 69 baht products', () => {
    const totals = calculateTotals([eligibleLine(1), eligibleLine(2)]);
    expect(totals.bundleSets).toBe(1);
    expect(totals.discount).toBe(7);
  });

  it('does not include products whose price is not exactly 69 baht', () => {
    const totals = calculateTotals([
      eligibleLine(2),
      { unitPrice: 68.99, quantity: 4, giveawayQuantity: 0 },
      { unitPrice: 70, quantity: 4, giveawayQuantity: 0 },
    ]);
    expect(totals.discount).toBe(0);
  });

  it('excludes giveaways from eligible quantity and paid subtotal', () => {
    const totals = calculateTotals([eligibleLine(5, 2)]);
    expect(totals.subtotal).toBe(207);
    expect(totals.bundleSets).toBe(1);
    expect(totals.discount).toBe(7);
    expect(totals.grandTotal).toBe(200);
  });

  it('uses a manual discount until automatic mode is reset', () => {
    const lines = [eligibleLine(6)];
    expect(calculateTotals(lines, setManualDiscount(5)).discount).toBe(5);
    expect(calculateTotals(lines, resetManualDiscount()).discount).toBe(14);
  });

  it('clamps manual discount to subtotal and negative values to zero', () => {
    expect(calculateTotals([eligibleLine(1)], setManualDiscount(100)).discount).toBe(69);
    expect(calculateTotals([eligibleLine(1)], setManualDiscount(-1)).discount).toBe(0);
    expect(calculateTotals([eligibleLine(1)], setManualDiscount(Infinity)).discount).toBe(69);
    expect(calculateTotals([eligibleLine(1)], setManualDiscount(Number.NaN)).discount).toBe(0);
  });

  it('keeps automatic discount within subtotal for larger quantities', () => {
    const totals = calculateTotals([eligibleLine(300)]);
    expect(totals.discount).toBeLessThanOrEqual(totals.subtotal);
    expect(totals.discount).toBe(700);
  });

  it('keeps VAT at zero', () => {
    const totals = calculateTotals([eligibleLine(3)]);
    expect(totals.vat).toBe(0);
    expect(totals.grandTotal).toBe(totals.subtotal - totals.discount);
  });
});
