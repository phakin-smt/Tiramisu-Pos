import { useState } from 'react';

import { EmptyState } from '../../components/AsyncState';
import { movedMenus } from '../../domain/reportMovements';
import type { ReportMenuSummary } from '../../types/reports';

export function ReportProductMovements({ items }: { items: ReportMenuSummary[] }) {
  // Remaining stock of an untouched menu is still worth a look now and then,
  // so the quiet rows are folded away rather than dropped.
  const [showAll, setShowAll] = useState(false);
  const moved = movedMenus(items);
  const hidden = items.length - moved.length;
  const rows = showAll ? [...moved, ...items.filter((item) => !moved.includes(item))] : moved;

  if (!items.length) return <EmptyState message="ไม่มีความเคลื่อนไหวของสินค้าในวันที่เลือก" />;
  return (
    <>
      {rows.length > 0
        ? <div className="table-scroll">
          <table className="report-movements">
            <thead><tr><th>เมนู</th><th>ขาย</th><th>แถม</th><th>เสีย</th><th>คงเหลือ</th></tr></thead>
            <tbody>{rows.map((item) => (
              <tr key={item.code}><td><strong>{item.name}</strong><small>{item.code} · {item.category}</small></td><td>{item.sold}</td><td>{item.giveaway}</td><td>{item.waste}</td><td>{item.remaining}</td></tr>
            ))}</tbody>
          </table>
        </div>
        : <EmptyState message="วันนี้ไม่มีเมนูที่ขาย แถม หรือเสีย" />}
      {hidden > 0 && (
        <button type="button" className="report-fold-toggle" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>
          {showAll ? 'ซ่อนเมนูที่ไม่มีความเคลื่อนไหว' : `แสดงอีก ${hidden} เมนูที่ไม่มีความเคลื่อนไหว`}
        </button>
      )}
    </>
  );
}
