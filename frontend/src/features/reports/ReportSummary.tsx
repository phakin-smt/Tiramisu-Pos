import { formatCurrency } from '../../domain/format';
import type { CloseDayReport } from '../../types/reports';

/**
 * What came in leads; the rest is there to check, not to read first. The till
 * is reconciled against cash and transfers, so those sit beside the total and
 * everything else drops to one quiet line.
 */
export function ReportSummary({ report }: { report: CloseDayReport }) {
  const expectedCash = report.openingFloat == null ? null : report.expectedCash ?? report.openingFloat + report.cashTotal;
  const secondary = [
    ['ยอดก่อนส่วนลด', report.subtotalAll],
    ['ส่วนลดรวม', report.discountAll],
    ['ต้นทุนรวม', report.costTotal],
    ['กำไรขั้นต้น', report.netProfit],
  ] as const;

  return (
    <div className="report-summary">
      <div className="report-headline">
        <article className="report-headline-total">
          <span>ยอดขายรวม</span>
          <strong>{formatCurrency(report.totalRevenue)}</strong>
          <small>{report.orderCount} ออเดอร์</small>
        </article>
        <article><span>เงินสด</span><strong>{formatCurrency(report.cashTotal)}</strong></article>
        <article><span>เงินโอน</span><strong>{formatCurrency(report.transferTotal)}</strong></article>
      </div>
      {expectedCash !== null && (
        <p className="report-drawer">
          <span>เงินสดที่ควรมีในลิ้นชัก <strong>{formatCurrency(expectedCash)}</strong></span>
          <small>เงินทอนตั้งต้น {formatCurrency(report.openingFloat!)} + ขายเงินสด {formatCurrency(report.cashTotal)}</small>
        </p>
      )}
      <dl className="report-secondary">
        {secondary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatCurrency(value)}</dd></div>)}
      </dl>
    </div>
  );
}
