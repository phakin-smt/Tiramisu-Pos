import { formatCurrency } from '../../domain/format';
import type { CatalogProduct } from '../../types/products';

interface ProductCardProps {
  product: CatalogProduct;
  remaining: number;
  onAdd(product: CatalogProduct): void;
}

export function ProductCard({ product, remaining, onAdd }: ProductCardProps) {
  const unavailable = remaining <= 0;
  return <button
    type="button"
    className="sell-product-card"
    disabled={unavailable}
    aria-label={unavailable ? `${product.name} สินค้าหมด` : `เพิ่ม ${product.name} ลงตะกร้า`}
    onClick={() => onAdd(product)}
  >
    <span className="sell-product-icon" aria-hidden="true">{product.icon || '□'}</span>
    <strong>{product.name}</strong>
    <span className="sell-product-code">{product.code}</span>
    <span className="sell-product-price">{formatCurrency(product.price)}</span>
    <span className="sell-product-stock">คงเหลือ {remaining} ชิ้น</span>
  </button>;
}
