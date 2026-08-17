import { EmptyState } from '../../components/AsyncState';
import { formatPercent } from '../../domain/format';
import type { StockSummaryItem } from '../../types/stock';

export function StockSummaryTable({ items }: { items: StockSummaryItem[] }) {
  if (!items.length) return <EmptyState message="ไม่มีข้อมูลสต็อกสำหรับวันที่เลือก" />;
  return <div className="table-scroll"><table><thead><tr><th>สินค้า</th><th>เตรียม</th><th>ขาย</th><th>แถม</th><th>เสีย</th><th>คงเหลือ</th><th>อัตราขาย</th></tr></thead><tbody>{items.map((item) => <tr key={item.productId}><td><strong>{item.name}</strong><small>{item.code} · {item.category}</small></td><td>{item.prepared}</td><td>{item.sold}</td><td>{item.giveaway}</td><td>{item.waste}</td><td>{item.stockNow}</td><td>{item.sellThrough === null ? '-' : formatPercent(item.sellThrough)}</td></tr>)}</tbody></table></div>;
}
