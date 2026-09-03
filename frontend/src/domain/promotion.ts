import { clamp } from './money';
import type { CartTotals, DiscountState, PricingLine } from '../types/domain';
import type { CustomerType } from '../types/checkout';

/** Buy `quantity` items priced at `unitPrice`, pay `price` for the set. */
export interface BundleRule {
  unitPrice: number;
  quantity: number;
  price: number;
}

/** Wholesale rate for shop customers, applied per paid piece in one category. */
export interface WholesaleRule {
  category: string;
  discountPerItem: number;
}

export interface PricingRules {
  bundle: BundleRule | null;
  wholesale: WholesaleRule | null;
}

/**
 * What a store applies before its own rules are known, and what a store with no
 * promotions applies for good: nothing automatic. Manual discounts still work.
 */
export const NO_PRICING_RULES: PricingRules = { bundle: null, wholesale: null };

/**
 * The rules the dessert shop has always used, kept here as the default for the
 * pure pricing function so its unit tests read as arithmetic rather than setup.
 * Anything serving a real till takes the rules from the server instead -- see
 * calculateCartTotals, which has no default for exactly that reason.
 */
export const BAANNOI_PRICING_RULES: PricingRules = {
  bundle: { unitPrice: 69, quantity: 3, price: 200 },
  wholesale: { category: 'Tiramisu', discountPerItem: 9 },
};

export const BUNDLE_UNIT_PRICE = BAANNOI_PRICING_RULES.bundle!.unitPrice;
export const BUNDLE_QUANTITY = BAANNOI_PRICING_RULES.bundle!.quantity;
export const BUNDLE_PRICE = BAANNOI_PRICING_RULES.bundle!.price;
export const BUNDLE_DISCOUNT = BUNDLE_UNIT_PRICE * BUNDLE_QUANTITY - BUNDLE_PRICE;
export const STORE_TIRAMISU_CATEGORY = BAANNOI_PRICING_RULES.wholesale!.category;
export const STORE_TIRAMISU_DISCOUNT = BAANNOI_PRICING_RULES.wholesale!.discountPerItem;

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
  rules: PricingRules = BAANNOI_PRICING_RULES,
): CartTotals {
  const subtotal = lines.reduce(
    (sum, line) => sum + line.unitPrice * paidQuantity(line),
    0,
  );
  // The bundle deliberately keys on unit price, not category: any item at the
  // trigger price counts towards a set.
  const eligibleQuantity = rules.bundle === null ? 0 : lines.reduce(
    (sum, line) =>
      line.unitPrice === rules.bundle!.unitPrice ? sum + paidQuantity(line) : sum,
    0,
  );
  const storeQuantity = rules.wholesale === null ? 0 : lines.reduce(
    (sum, line) =>
      line.category === rules.wholesale!.category ? sum + paidQuantity(line) : sum,
    0,
  );
  // A shop customer is on wholesale pricing, so the per-piece rate replaces the
  // bundle promotion rather than stacking with it.
  const store = customerType === 'store';
  const bundleDiscount = rules.bundle === null
    ? 0
    : rules.bundle.unitPrice * rules.bundle.quantity - rules.bundle.price;
  const bundleSets = store || rules.bundle === null
    ? 0
    : Math.floor(eligibleQuantity / rules.bundle.quantity);
  const storeDiscount = store && rules.wholesale !== null
    ? storeQuantity * rules.wholesale.discountPerItem
    : 0;
  const autoDiscount = store ? storeDiscount : bundleSets * bundleDiscount;
  const requestedDiscount = discountState.manual ? discountState.value : autoDiscount;
  const normalizedDiscount = requestedDiscount || 0;
  const discount = clamp(normalizedDiscount, 0, subtotal);
  const vat = 0;
  const grandTotal = subtotal - discount + vat;

  return { subtotal, bundleSets, storeDiscount, autoDiscount, discount, vat, grandTotal };
}
