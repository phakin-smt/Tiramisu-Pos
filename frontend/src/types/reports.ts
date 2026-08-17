export interface ReportDay {
  date: string;
  orderCount: number;
  totalRevenue: number;
  closedAt: string | null;
  soldQty: number;
  giveawayQty: number;
  remainingQty: number;
}

export interface ReportDaysResponse {
  days: ReportDay[];
}

export interface DailySummaryResponse {
  date: string;
  orderCount: number;
  cashTotal: number;
  transferTotal: number;
  totalRevenue: number;
}

export interface ReportOrderItem {
  name: string;
  code: string;
  qty: number;
  giveawayQty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ReportOrder {
  orderNumber: string;
  time: string;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  total: number;
  items: ReportOrderItem[];
}

export interface ReportMenuSummary {
  code: string;
  name: string;
  category: string;
  icon: string;
  active: boolean;
  sold: number;
  giveaway: number;
  waste: number;
  remaining: number;
}

export interface CloseDayReport {
  date: string;
  orderCount: number;
  subtotalAll: number;
  discountAll: number;
  cashTotal: number;
  transferTotal: number;
  totalRevenue: number;
  costTotal: number;
  netProfit: number;
  orders: ReportOrder[];
  menuSummary: ReportMenuSummary[];
}
