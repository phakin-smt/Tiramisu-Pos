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

export type StockAdjustmentReason =
  | 'prepare'
  | 'undo_prepare'
  | 'giveaway'
  | 'undo_giveaway'
  | 'waste'
  | 'undo_waste';

export interface StockAdjustmentRequest {
  productId: number;
  reason: StockAdjustmentReason;
  quantity: number;
}

export interface StockAdjustmentResponse {
  productId: number;
  stock: number;
}

export interface StockPlan {
  id: number;
  productId: number;
  date: string;
  quantity: number;
  name: string;
  code: string;
}

export interface CreateStockPlanRequest {
  productId: number;
  date: string;
  quantity: number;
  note?: string;
}

export interface CreateStockPlanResponse { id: number; }
export interface CancelStockPlanResponse { id: number; cancelled: boolean; }
