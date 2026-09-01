import { formatCurrency } from '../../domain/format';
import type { CloseDayReport } from '../../types/reports';

export function ReportSummary({ report }: { report: CloseDayReport }) {
  const metrics = [
    ['ยอดขายรวม', report.totalRevenue],
    ['เงินสด', report.cashTotal],
    ['เงินโอน', report.transferTotal],
    ['ยอดก่อนส่วนลด', report.subtotalAll],
    ['ส่วนลดรวม', report.discountAll],
    ['ต้นทุนรวม', report.costTotal],
    ['กำไรขั้นต้น', report.netProfit],
  ] as const;

  return (
    <div className="metrics-grid report-metrics">
      {metrics.map(([label, value]) => (
        <article className="metric" key={label}>
          <span>{label}</span>
          <strong>{formatCurrency(value)}</strong>
        </article>
      ))}
      <article className="metric">
        <span>จำนวนออเดอร์</span>
        <strong>{report.orderCount}</strong>
      </article>
    </div>
  );
}
