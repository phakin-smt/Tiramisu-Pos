import { EmptyState } from '../../components/AsyncState';
import { formatThaiDate } from '../../domain/date';
import { formatCurrency } from '../../domain/format';
import type { AnalyticsDay } from '../../types/analytics';

export function SalesChart({ days }: { days: AnalyticsDay[] }) {
  if (!days.length) return <EmptyState message="ไม่มีข้อมูลยอดขายในช่วงเวลานี้" />;
  const maximum = Math.max(...days.map((day) => day.revenue), 1);
  return (
    <>
      <div className="sales-chart" aria-hidden="true">
        {days.map((day) => (
          <div className="chart-column" key={day.date}>
            <span className="chart-value">{formatCurrency(day.revenue)}</span>
            <div className="chart-track"><span style={{ height: `${Math.max((day.revenue / maximum) * 100, day.revenue ? 4 : 0)}%` }} /></div>
            <small>{formatThaiDate(day.date)}</small>
          </div>
        ))}
      </div>
      <div className="visually-hidden">
        <table><caption>ข้อมูลยอดขายรายวัน</caption><thead><tr><th>วันที่</th><th>ออเดอร์</th><th>ยอดขาย</th></tr></thead><tbody>{days.map((day) => <tr key={day.date}><td>{formatThaiDate(day.date)}</td><td>{day.orderCount}</td><td>{formatCurrency(day.revenue)}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
