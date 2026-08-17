import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState';
import { PageHeader } from '../../components/PageHeader';
import { formatThaiDate } from '../../domain/date';
import { ReportDayList } from './ReportDayList';
import { ReportOrders } from './ReportOrders';
import { ReportProductMovements } from './ReportProductMovements';
import { ReportSummary } from './ReportSummary';
import { useReportDays, useReportDetail } from './useReports';

export function ReportsPage() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const days = useReportDays();
  const detail = useReportDetail(selectedDate);
  const selectedDay = days.data?.days.find((day) => day.date === selectedDate);

  return (
    <section className="data-page">
      <PageHeader title="รายงาน" />
      <div className="report-workspace">
        <aside className="surface report-days-panel">
          <h2>รายการรายวัน</h2>
          <ReportDayList days={days.data?.days ?? null} loading={days.loading} error={days.error} selectedDate={selectedDate} onSelect={setSelectedDate} />
        </aside>
        <div className="report-detail" aria-live="polite">
          {!selectedDate && <EmptyState message="เลือกวันที่เพื่อดูรายละเอียดรายงาน" />}
          {selectedDate && detail.loading && <LoadingState label="กำลังโหลดรายละเอียดรายงาน" />}
          {selectedDate && detail.error && <ErrorState message={detail.error} />}
          {detail.data && (
            <>
              <div className="section-heading"><div><h2>{formatThaiDate(detail.data.date)}</h2><span>{selectedDay?.closedAt ? `ปิดยอดแล้ว ${selectedDay.closedAt.slice(11, 16)}` : 'ยังไม่ปิดยอด · อ่านอย่างเดียว'}</span></div></div>
              <ReportSummary report={detail.data} />
              <section className="surface"><h2>รายการออเดอร์</h2><ReportOrders orders={detail.data.orders} /></section>
              <section className="surface"><h2>ความเคลื่อนไหวสินค้า</h2><ReportProductMovements items={detail.data.menuSummary} /></section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
