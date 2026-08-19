import { EmptyState } from '../../components/AsyncState';
import { formatPercent } from '../../domain/format';
import type { StockAdjustmentReason, StockSummaryItem } from '../../types/stock';
import { StockAdjustmentControls } from './StockAdjustmentControls';

interface Props {
  items: StockSummaryItem[];
  editable?: boolean;
  pending?: boolean;
  onAdjust?(productId: number, reason: StockAdjustmentReason, quantity: number): Promise<boolean>;
  onCorrect?(item: StockSummaryItem): void;
}

export function StockSummaryTable({ items, editable = false, pending = false, onAdjust, onCorrect }: Props) {
  if (!items.length) return <EmptyState message="ไม่มีข้อมูลสต็อกสำหรับวันที่เลือก" />;
  return <div className="table-scroll stock-table-scroll"><table className="stock-summary-table"><thead><tr><th>สินค้า</th><th>เตรียม</th><th>ขาย</th><th>แถม</th><th>เสีย</th><th>คงเหลือ</th><th>อัตราขาย</th><th>{editable ? 'ปรับจำนวน' : 'แก้ไข'}</th></tr></thead><tbody>{items.map((item) => <tr key={item.productId}><td className="stock-product-cell"><strong>{item.name}</strong><small>{item.code} · {item.category}</small></td><td>{item.prepared}</td><td className="stock-sold-value">{item.sold}</td><td className="stock-giveaway-value">{item.giveaway}</td><td className="stock-waste-value">{item.waste}</td><td className="stock-balance-value">{item.stockNow}</td><td>{item.sellThrough === null ? '-' : formatPercent(item.sellThrough)}</td><td>{editable ? <StockAdjustmentControls item={item} disabled={pending} onAdjust={(reason, quantity) => onAdjust?.(item.productId, reason, quantity) ?? Promise.resolve(false)} /> : <button type="button" className="secondary-button" aria-label={`ปรับยอดย้อนหลัง ${item.name}`} onClick={() => onCorrect?.(item)}>ปรับยอดย้อนหลัง</button>}</td></tr>)}</tbody></table></div>;
}
