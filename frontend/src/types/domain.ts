export interface Product {
  id: number;
  price: number;
  stock: number;
  category: string;
}

export interface CartItem {
  productId: number;
  qty: number;
  giveawayQty: number;
}

export interface PricingLine {
  unitPrice: number;
  quantity: number;
  giveawayQuantity: number;
  category: string;
}

export interface DiscountState {
  manual: boolean;
  value: number;
}

export interface CartTotals {
  subtotal: number;
  bundleSets: number;
  /** Wholesale reduction given to a shop customer, before clamping. */
  storeDiscount: number;
  autoDiscount: number;
  discount: number;
  vat: number;
  grandTotal: number;
}
