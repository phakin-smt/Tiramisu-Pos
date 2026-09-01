export type CustomerType = 'walkin' | 'member' | 'store';
export type PaymentMethod = 'cash' | 'transfer';

export interface CreateOrderItem {
  productId: number;
  qty: number;
  giveawayQty: number;
}

/**
 * Present only when replaying a sale that already completed on the device, so
 * the server keeps the original business date instead of stamping sync time.
 */
export interface OfflineOrderStamp {
  businessDate: string;
  createdAt: string;
  localOrderNumber: string;
}

export interface CreateOrderRequest {
  items: CreateOrderItem[];
  paymentMethod: PaymentMethod;
  customerType: CustomerType;
  discount: number;
  offline?: OfflineOrderStamp;
}

export interface CreateOrderResponse {
  orderNumber: string;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  paymentMethod: PaymentMethod;
  duplicate?: boolean;
  /** The server floored stock at zero for this sale; it needs reconciling. */
  stockReview?: boolean;
  stockShortfalls?: Array<{ productId: number; productName: string; shortfall: number }>;
}
