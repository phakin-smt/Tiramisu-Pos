import { remainingStock } from '../../domain/cart';
import type { CartItem } from '../../types/domain';
import type { CatalogProduct } from '../../types/products';
import { ProductCard } from './ProductCard';

interface ProductGridProps {
  products: readonly CatalogProduct[];
  cart: readonly CartItem[];
  photos?: ReadonlyMap<number, string>;
  onAdd(product: CatalogProduct): void;
}

export function ProductGrid({ products, cart, photos, onAdd }: ProductGridProps) {
  if (!products.length) return <div className="empty-state">ไม่มีสินค้าในหมวดหมู่นี้</div>;
  return <div className="sell-product-grid">
    {products.map((product) => <ProductCard key={product.id} product={product} remaining={remainingStock(product, cart)} photoUrl={photos?.get(product.id)} onAdd={onAdd} />)}
  </div>;
}
