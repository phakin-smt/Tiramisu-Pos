export interface OrderItem {
  name: string;
  code: string;
  qty: number;
  giveawayQty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  id: number;
  orderNumber: string;
  time: string;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  total: number;
  status: string;
  items: OrderItem[];
}

export interface OrdersResponse {
  date: string;
  orders: Order[];
}

export interface CancelOrderResponse {
  id: number;
  cancelled: boolean;
}
