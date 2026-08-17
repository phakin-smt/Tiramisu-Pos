import { useState } from 'react';
import { ErrorState, LoadingState } from '../../components/AsyncState';
import { PageHeader } from '../../components/PageHeader';
import { formatThaiDate } from '../../domain/date';
import type { AnalyticsRange } from '../../types/analytics';
import { AnalyticsRangeSelector } from './AnalyticsRangeSelector';
import { Losses, LowStockList, TopProducts } from './AnalyticsLists';
import { AnalyticsSummary } from './AnalyticsSummary';
import { SalesChart } from './SalesChart';
import { useAnalytics } from './useAnalytics';

export function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>(7);
  const query = useAnalytics(range);
  return (
    <section className="data-page">
      <PageHeader title="วิเคราะห์" />
      <div className="page-toolbar"><AnalyticsRangeSelector value={range} onChange={setRange} /></div>
      <div aria-live="polite">
        {query.loading && <LoadingState label="กำลังโหลดข้อมูลวิเคราะห์" />}
        {query.error && <ErrorState message={query.error} />}
        {query.data && <>
          <div className="section-heading"><div><h2>{formatThaiDate(query.data.startDate)} – {formatThaiDate(query.data.endDate)}</h2><span>ข้อมูลย้อนหลัง {range} วัน</span></div></div>
          <AnalyticsSummary overview={query.data.overview} />
          <section className="surface"><h2>แนวโน้มยอดขาย</h2><SalesChart days={query.data.daily} /></section>
          <div className="content-grid">
            <section className="surface"><h2>สินค้าขายดี</h2><TopProducts products={query.data.topProducts} /></section>
            <section className="surface"><h2>ของแถมและของเสีย</h2><Losses products={query.data.losses} /></section>
            <section className="surface"><h2>สินค้าใกล้หมด</h2><LowStockList products={query.data.lowStock} /></section>
          </div>
        </>}
      </div>
    </section>
  );
}
