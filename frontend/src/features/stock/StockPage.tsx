import { useState } from 'react';
import { ErrorState, LoadingState } from '../../components/AsyncState';
import { PageHeader } from '../../components/PageHeader';
import { bangkokDateISO, formatThaiDate } from '../../domain/date';
import { StockDatePicker } from './StockDatePicker';
import { StockSummaryTable } from './StockSummaryTable';
import { useStockSummary } from './useStockSummary';

export function StockPage() {
  const today = bangkokDateISO();
  const [date, setDate] = useState(today);
  const query = useStockSummary(date);
  return (
    <section className="data-page">
      <PageHeader title="จัดการสต็อก" />
      <div className="page-toolbar">
        <StockDatePicker value={date} maximum={today} onChange={setDate} />
        <span className="read-only-label">อ่านอย่างเดียว</span>
      </div>
      <div aria-live="polite">
        {query.loading && <LoadingState label="กำลังโหลดข้อมูลสต็อก" />}
        {query.error && <ErrorState message={query.error} />}
        {query.data && (
          <section className="surface">
            <div className="section-heading"><div><h2>{formatThaiDate(query.data.date)}</h2><span>สรุปความเคลื่อนไหวรายสินค้า</span></div></div>
            <StockSummaryTable items={query.data.items} />
          </section>
        )}
      </div>
    </section>
  );
}
