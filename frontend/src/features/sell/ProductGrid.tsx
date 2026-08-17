import { remainingStock } from '../../domain/cart';
import type { CartItem } from '../../types/domain';
import type { CatalogProduct } from '../../types/products';
import { ProductCard } from './ProductCard';

interface ProductGridProps {
  products: readonly CatalogProduct[];
  cart: readonly CartItem[];
  onAdd(product: CatalogProduct): void;
}

export function ProductGrid({ products, cart, onAdd }: ProductGridProps) {
  if (!products.length) return <div className="empty-state">ไม่มีสินค้าในหมวดหมู่นี้</div>;
  return <div className="sell-product-grid">
    {products.map((product) => <ProductCard key={product.id} product={product} remaining={remainingStock(product, cart)} onAdd={onAdd} />)}
  </div>;
}
