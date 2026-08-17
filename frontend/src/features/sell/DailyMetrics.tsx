import { ErrorState, LoadingState } from '../../components/AsyncState';
import { formatCurrency } from '../../domain/format';
import type { DailySummaryResponse } from '../../types/reports';

interface DailyMetricsProps {
  summary: DailySummaryResponse | null;
  productCount: number;
  loading: boolean;
  error: string;
  collapsed: boolean;
  onToggle(): void;
}

export function DailyMetrics({ summary, productCount, loading, error, collapsed, onToggle }: DailyMetricsProps) {
  return <section className="sell-summary" aria-labelledby="daily-summary-title">
    <div className="section-heading sell-summary-heading">
      <h2 id="daily-summary-title">สรุปยอดวันนี้</h2>
      <button type="button" className="secondary-button summary-toggle" aria-expanded={!collapsed} aria-controls="daily-metrics" onClick={onToggle}>
        {collapsed ? 'แสดงสรุป' : 'ซ่อนสรุป'}
      </button>
    </div>
    {!collapsed && <div id="daily-metrics" aria-live="polite">
      {loading && <LoadingState label="กำลังโหลดสรุปยอดวันนี้" />}
      {error && <ErrorState message={error} />}
      {summary && <div className="metrics-grid sell-metrics">
        <article className="metric"><span>ยอดขายวันนี้</span><strong>{formatCurrency(summary.totalRevenue)}</strong></article>
        <article className="metric"><span>จำนวนออเดอร์</span><strong>{summary.orderCount}</strong></article>
        <article className="metric"><span>เงินสด</span><strong>{formatCurrency(summary.cashTotal)}</strong></article>
        <article className="metric"><span>เงินโอน</span><strong>{formatCurrency(summary.transferTotal)}</strong></article>
        <article className="metric"><span>เมนูพร้อมขาย</span><strong>{productCount}</strong></article>
      </div>}
    </div>}
  </section>;
}
