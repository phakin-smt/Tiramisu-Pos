export interface ProductPayload {
  code: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  active: boolean;
}

export interface CatalogProduct {
  id: number;
  code: string;
  barcode: string | null;
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  active: boolean;
  icon: string;
}

export interface ProductMutationResponse {
  id: number;
  code: string;
}

export interface ProductActiveResponse { id: number; active: boolean; }
export interface DeleteProductResponse { id: number; deleted: boolean; }
