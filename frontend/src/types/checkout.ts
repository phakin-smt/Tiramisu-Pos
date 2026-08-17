export type CustomerType = 'walkin' | 'member' | 'store';
export type PaymentMethod = 'cash' | 'transfer';

export interface CreateOrderItem {
  productId: number;
  qty: number;
  giveawayQty: number;
}

export interface CreateOrderRequest {
  items: CreateOrderItem[];
  paymentMethod: PaymentMethod;
  customerType: CustomerType;
  discount: number;
}

export interface CreateOrderResponse {
  orderNumber: string;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  paymentMethod: PaymentMethod;
  duplicate?: boolean;
}
