import { formatCurrency } from '../../domain/format';
import type { AnalyticsOverview } from '../../types/analytics';

export function AnalyticsSummary({ overview }: { overview: AnalyticsOverview }) {
  const metrics = [
    ['ยอดขาย', formatCurrency(overview.revenue)],
    ['ออเดอร์', overview.orderCount.toLocaleString('th-TH')],
    ['ยอดเฉลี่ยต่อออเดอร์', formatCurrency(overview.averageTicket)],
    ['ส่วนลด', formatCurrency(overview.discount)],
    ['ต้นทุน', formatCurrency(overview.cost)],
    ['กำไรขั้นต้น', formatCurrency(overview.grossProfit)],
  ];
  return <div className="metrics-grid">{metrics.map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>;
}
