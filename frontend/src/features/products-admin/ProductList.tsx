import { EmptyState } from '../../components/AsyncState';
import { formatCurrency } from '../../domain/format';
import type { StockSummaryItem } from '../../types/stock';

interface Props {
  products: StockSummaryItem[];
  pending: boolean;
  onEdit(product: StockSummaryItem): void;
  onActive(product: StockSummaryItem, active: boolean): void;
  onDelete(product: StockSummaryItem): void;
}

export function ProductList({ products, pending, onEdit, onActive, onDelete }: Props) {
  if (!products.length) return <EmptyState message="ไม่พบเมนูที่ตรงกับตัวกรอง" />;
  return <div className="product-admin-list">{products.map((product) => (
    <article className={`product-admin-item${product.active ? '' : ' is-inactive'}`} key={product.productId}>
      <div className="product-admin-icon" aria-hidden="true">{product.icon || '•'}</div>
      <div className="product-admin-info"><strong>{product.name}</strong><span>{product.code} · {product.category} · {formatCurrency(product.price)}</span><small>คงเหลือ {product.stockNow} · ขั้นต่ำ {product.minStock} · ต้นทุน {formatCurrency(product.cost)}</small></div>
      <label className="active-toggle"><input type="checkbox" aria-label={`เปิดขาย ${product.name}`} checked={product.active} disabled={pending} onChange={(event) => onActive(product, event.target.checked)} /><span>{product.active ? 'เปิดขาย' : 'พักขาย'}</span></label>
      <div className="product-admin-actions"><button type="button" className="secondary-button" aria-label={`แก้ไข ${product.name}`} disabled={pending} onClick={() => onEdit(product)}>แก้ไข</button><button type="button" className="danger-text-button" aria-label={`ลบ ${product.name}`} disabled={pending} onClick={() => onDelete(product)}>ลบ</button></div>
    </article>
  ))}</div>;
}
