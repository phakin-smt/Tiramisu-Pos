import { EmptyState } from '../../components/AsyncState';
import type { ReportMenuSummary } from '../../types/reports';

export function ReportProductMovements({ items }: { items: ReportMenuSummary[] }) {
  if (!items.length) return <EmptyState message="ไม่มีความเคลื่อนไหวของสินค้าในวันที่เลือก" />;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>เมนู</th><th>ขาย</th><th>แถม</th><th>เสีย</th><th>คงเหลือ</th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item.code}><td><strong>{item.name}</strong><small>{item.code} · {item.category}</small></td><td>{item.sold}</td><td>{item.giveaway}</td><td>{item.waste}</td><td>{item.remaining}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
