import { describe, expect, it } from 'vitest';

import {
  automaticDiscountState,
  calculateTotals,
  resetManualDiscount,
  setManualDiscount,
} from './promotion';
import type { PricingLine } from '../types/domain';

const eligibleLine = (quantity: number, giveawayQuantity = 0): PricingLine => ({
  unitPrice: 69,
  quantity,
  giveawayQuantity,
  category: 'Tiramisu',
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
      { unitPrice: 68.99, quantity: 4, giveawayQuantity: 0, category: 'Tiramisu' },
      { unitPrice: 70, quantity: 4, giveawayQuantity: 0, category: 'Tiramisu' },
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

const line = (unitPrice: number, quantity: number, category: string, giveawayQuantity = 0): PricingLine =>
  ({ unitPrice, quantity, giveawayQuantity, category });

describe('shop customer wholesale rate', () => {
    it('takes 9 baht off every paid Tiramisu piece', () => {
      const totals = calculateTotals([line(69, 2, 'Tiramisu')], automaticDiscountState, 'store');

      expect(totals.subtotal).toBe(138);
      expect(totals.storeDiscount).toBe(18);
      expect(totals.discount).toBe(18);
      expect(totals.grandTotal).toBe(120);
    });

    it('applies to every product in the category, whatever it is priced at', () => {
      // The category is what qualifies, not the 69-baht bundle price.
      const totals = calculateTotals([line(99, 2, 'Tiramisu')], automaticDiscountState, 'store');

      expect(totals.storeDiscount).toBe(18);
      expect(totals.grandTotal).toBe(180);
    });

    it('leaves other categories alone', () => {
      const totals = calculateTotals(
        [line(69, 1, 'Tiramisu'), line(60, 2, 'Cheesecake')],
        automaticDiscountState,
        'store',
      );

      expect(totals.storeDiscount).toBe(9);
      expect(totals.grandTotal).toBe(69 + 120 - 9);
    });

    it('replaces the three-for-200 promotion rather than stacking with it', () => {
      const cart = [line(69, 3, 'Tiramisu')];

      const shop = calculateTotals(cart, automaticDiscountState, 'store');
      const walkIn = calculateTotals(cart, automaticDiscountState, 'walkin');

      expect(shop.bundleSets).toBe(0);
      expect(shop.discount).toBe(27);
      expect(shop.grandTotal).toBe(180);
      // The walk-in promotion is untouched by the new rule.
      expect(walkIn.bundleSets).toBe(1);
      expect(walkIn.discount).toBe(7);
      expect(walkIn.grandTotal).toBe(200);
    });

    it('does not discount giveaway pieces', () => {
      const totals = calculateTotals([line(69, 3, 'Tiramisu', 1)], automaticDiscountState, 'store');

      // Two paid pieces, so 18 baht rather than 27.
      expect(totals.subtotal).toBe(138);
      expect(totals.storeDiscount).toBe(18);
      expect(totals.grandTotal).toBe(120);
    });

    it('gives walk-in and member customers nothing from the shop rate', () => {
      for (const customerType of ['walkin', 'member'] as const) {
        const totals = calculateTotals([line(69, 2, 'Tiramisu')], automaticDiscountState, customerType);
        expect(totals.storeDiscount).toBe(0);
        expect(totals.grandTotal).toBe(138);
      }
    });

    it('lets a manual discount override the shop rate, as it does the promotion', () => {
      const totals = calculateTotals([line(69, 2, 'Tiramisu')], setManualDiscount(50), 'store');

      expect(totals.storeDiscount).toBe(18);
      expect(totals.discount).toBe(50);
      expect(totals.grandTotal).toBe(88);
    });

    it('never discounts past the subtotal', () => {
      // Ten pieces of a 5-baht item would otherwise owe more discount than value.
      const totals = calculateTotals([line(5, 10, 'Tiramisu')], automaticDiscountState, 'store');

      expect(totals.discount).toBe(50);
      expect(totals.grandTotal).toBe(0);
    });
  });
