export type AnalyticsRange = 1 | 7 | 30;

export interface AnalyticsOverview {
  revenue: number;
  orderCount: number;
  averageTicket: number;
  discount: number;
  cost: number;
  grossProfit: number;
}

export interface AnalyticsDay {
  date: string;
  orderCount: number;
  revenue: number;
}

export interface TopProduct {
  productId: number;
  name: string;
  code: string;
  soldQty: number;
  revenue: number;
}

export interface ProductLoss {
  productId: number;
  name: string;
  code: string;
  giveawayQty: number;
  wasteQty: number;
}

export interface LowStockProduct {
  productId: number;
  name: string;
  code: string;
  stock: number;
  minStock: number;
}

export interface AnalyticsResponse {
  startDate: string;
  endDate: string;
  overview: AnalyticsOverview;
  daily: AnalyticsDay[];
  topProducts: TopProduct[];
  losses: ProductLoss[];
  lowStock: LowStockProduct[];
}
