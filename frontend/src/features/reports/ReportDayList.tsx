import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState';
import { formatThaiDate, formatTime } from '../../domain/date';
import { formatCurrency } from '../../domain/format';
import type { ReportDay } from '../../types/reports';

interface Props {
  days: ReportDay[] | null;
  loading: boolean;
  error: string;
  selectedDate: string | null;
  onSelect(date: string): void;
}

export function ReportDayList({ days, loading, error, selectedDate, onSelect }: Props) {
  if (loading) return <LoadingState label="กำลังโหลดรายการรายงาน" />;
  if (error) return <ErrorState message={error} />;
  if (!days?.length) return <EmptyState message="ยังไม่มีข้อมูลการขาย" />;

  return (
    <div className="report-day-list">
      {days.map((day) => (
        <button
          key={day.date}
          type="button"
          className="report-day-button"
          aria-pressed={selectedDate === day.date}
          onClick={() => onSelect(day.date)}
        >
          <span>
            <strong>{formatThaiDate(day.date)}</strong>
            <small>{day.orderCount} ออเดอร์ · ขาย {day.soldQty} · แถม {day.giveawayQty} · เหลือ {day.remainingQty}</small>
          </span>
          <span className="report-day-value">
            <strong>{formatCurrency(day.totalRevenue)}</strong>
            <small>{day.closedAt ? `ปิดยอด ${formatTime(day.closedAt)}` : 'ยังไม่ปิดยอด'}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
