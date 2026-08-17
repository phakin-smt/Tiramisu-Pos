export interface Product {
  id: number;
  price: number;
  stock: number;
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
}

export interface DiscountState {
  manual: boolean;
  value: number;
}

export interface CartTotals {
  subtotal: number;
  bundleSets: number;
  autoDiscount: number;
  discount: number;
  vat: number;
  grandTotal: number;
}
