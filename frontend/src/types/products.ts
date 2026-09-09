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
  // Null for a menu with no photo, which falls back to the category emoji.
  imageUrl: string | null;
}

export interface ProductMutationResponse {
  id: number;
  code: string;
}

export interface ProductActiveResponse { id: number; active: boolean; }
export interface DeleteProductResponse { id: number; deleted: boolean; }
