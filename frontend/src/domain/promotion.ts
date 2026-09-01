import { clamp } from './money';
import type { CartTotals, DiscountState, PricingLine } from '../types/domain';
import type { CustomerType } from '../types/checkout';

export const BUNDLE_UNIT_PRICE = 69;
export const BUNDLE_QUANTITY = 3;
export const BUNDLE_PRICE = 200;
export const BUNDLE_DISCOUNT = BUNDLE_UNIT_PRICE * BUNDLE_QUANTITY - BUNDLE_PRICE;

/** Wholesale rate for shop customers, applied per paid piece. */
export const STORE_TIRAMISU_CATEGORY = 'Tiramisu';
export const STORE_TIRAMISU_DISCOUNT = 9;

export const automaticDiscountState: DiscountState = { manual: false, value: 0 };

export function setManualDiscount(value: number): DiscountState {
  return { manual: true, value };
}

export function resetManualDiscount(): DiscountState {
  return { ...automaticDiscountState };
}

export function paidQuantity(line: PricingLine): number {
  return line.quantity - line.giveawayQuantity;
}

export function calculateTotals(
  lines: readonly PricingLine[],
  discountState: DiscountState = automaticDiscountState,
  customerType: CustomerType = 'walkin',
): CartTotals {
  const subtotal = lines.reduce(
    (sum, line) => sum + line.unitPrice * paidQuantity(line),
    0,
  );
  const eligibleQuantity = lines.reduce(
    (sum, line) =>
      line.unitPrice === BUNDLE_UNIT_PRICE ? sum + paidQuantity(line) : sum,
    0,
  );
  const storeQuantity = lines.reduce(
    (sum, line) =>
      line.category === STORE_TIRAMISU_CATEGORY ? sum + paidQuantity(line) : sum,
    0,
  );
  // A shop customer is on wholesale pricing, so the per-piece rate replaces the
  // three-for-200 promotion rather than stacking with it.
  const store = customerType === 'store';
  const bundleSets = store ? 0 : Math.floor(eligibleQuantity / BUNDLE_QUANTITY);
  const storeDiscount = store ? storeQuantity * STORE_TIRAMISU_DISCOUNT : 0;
  const autoDiscount = store ? storeDiscount : bundleSets * BUNDLE_DISCOUNT;
  const requestedDiscount = discountState.manual ? discountState.value : autoDiscount;
  const normalizedDiscount = requestedDiscount || 0;
  const discount = clamp(normalizedDiscount, 0, subtotal);
  const vat = 0;
  const grandTotal = subtotal - discount + vat;

  return { subtotal, bundleSets, storeDiscount, autoDiscount, discount, vat, grandTotal };
}
