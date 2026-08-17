import { EmptyState } from '../../components/AsyncState';
import { formatCurrency } from '../../domain/format';
import type { LowStockProduct, ProductLoss, TopProduct } from '../../types/analytics';

export function TopProducts({ products }: { products: TopProduct[] }) {
  if (!products.length) return <EmptyState message="ไม่มีข้อมูลสินค้าขายดี" />;
  return <ol className="ranked-list">{products.map((product) => <li key={product.productId}><span><strong>{product.name}</strong><small>{product.code} · ขาย {product.soldQty}</small></span><strong>{formatCurrency(product.revenue)}</strong></li>)}</ol>;
}

export function Losses({ products }: { products: ProductLoss[] }) {
  if (!products.length) return <EmptyState message="ไม่มีรายการแถมหรือเสีย" />;
  return <div className="compact-list">{products.map((product) => <div key={product.productId}><span><strong>{product.name}</strong><small>{product.code}</small></span><span>แถม {product.giveawayQty} · เสีย {product.wasteQty}</span></div>)}</div>;
}

export function LowStockList({ products }: { products: LowStockProduct[] }) {
  if (!products.length) return <EmptyState message="ไม่มีสินค้าใกล้หมด" />;
  return <div className="compact-list">{products.map((product) => <div key={product.productId}><span><strong>{product.name}</strong><small>{product.code}</small></span><span>คงเหลือ {product.stock} / ขั้นต่ำ {product.minStock}</span></div>)}</div>;
}
