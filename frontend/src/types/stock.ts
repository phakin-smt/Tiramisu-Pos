export interface StockSummaryItem {
  productId: number;
  code: string;
  name: string;
  category: string;
  icon: string;
  active: boolean;
  price: number;
  cost: number;
  minStock: number;
  stockNow: number;
  prepared: number;
  sold: number;
  giveaway: number;
  waste: number;
  sellThrough: number | null;
}

export interface StockSummaryResponse {
  date: string;
  items: StockSummaryItem[];
}
