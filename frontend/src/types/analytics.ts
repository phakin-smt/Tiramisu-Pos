export type AnalyticsPreset = 1 | 7 | 30;

/** A preset counts back from today; a custom range names both ends, inclusive. */
export type AnalyticsRange = AnalyticsPreset | { start: string; end: string };

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
