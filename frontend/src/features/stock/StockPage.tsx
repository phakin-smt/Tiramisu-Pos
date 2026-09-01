import { useState } from 'react';
import { adjustStock } from '../../api/stock';
import { ErrorState, LoadingState } from '../../components/AsyncState';
import { MutationFeedback } from '../../components/MutationFeedback';
import { PageHeader } from '../../components/PageHeader';
import { bangkokDateISO, formatThaiDate } from '../../domain/date';
import { StockDatePicker } from './StockDatePicker';
import { StockSummaryTable } from './StockSummaryTable';
import { StockPlansPanel } from './StockPlansPanel';
import { useStockSummary } from './useStockSummary';
import { useStockPlans } from './useStockPlans';
import { useSafeMutation } from '../shared/useSafeMutation';
import type { StockAdjustmentReason } from '../../types/stock';
import type { StockSummaryItem } from '../../types/stock';
import { HistoricalCorrectionModal } from './HistoricalCorrectionModal';
import { StockReconciliationPanel } from './StockReconciliationPanel';

const actionLabels: Record<StockAdjustmentReason, string> = {
  prepare: 'เตรียมเพิ่ม', undo_prepare: 'ยกเลิกเตรียม', giveaway: 'บันทึกแถม',
  undo_giveaway: 'ยกเลิกแถม', waste: 'บันทึกของเสีย', undo_waste: 'ยกเลิกของเสีย',
};

export function StockPage() {
  const today = bangkokDateISO();
  const [date, setDate] = useState(today);
  const [stockRevision, setStockRevision] = useState(0);
  const [planRevision, setPlanRevision] = useState(0);
  const [correctionItem, setCorrectionItem] = useState<StockSummaryItem | null>(null);
  const [correctionSuccess, setCorrectionSuccess] = useState('');
  const query = useStockSummary(date, stockRevision);
  const plans = useStockPlans(planRevision);
  const mutation = useSafeMutation();
  const isToday = date === today;

  const handleAdjust = async (productId: number, reason: StockAdjustmentReason, quantity: number) => {
    const result = await mutation.run(
      () => adjustStock({ productId, reason, quantity }),
      `${actionLabels[reason]} ${quantity} ชิ้นแล้ว`,
    );
    if (result) setStockRevision((current) => current + 1);
    return Boolean(result);
  };

  const refreshPlansAndStock = () => {
    setPlanRevision((current) => current + 1);
    setStockRevision((current) => current + 1);
  };
  return (
    <section className="data-page">
      <PageHeader title="จัดการสต็อก" />
      <div className="page-toolbar">
        <StockDatePicker value={date} maximum={today} onChange={setDate} />
        <span className="read-only-label">{isToday ? 'ปรับสต็อกวันนี้' : 'อ่านอย่างเดียว'}</span>
      </div>
      <MutationFeedback error={mutation.error} success={mutation.success} />
      <MutationFeedback error="" success={correctionSuccess} />
      <StockReconciliationPanel
        serverStock={new Map((query.data?.items ?? []).map((item) => [item.productId, item.stockNow]))}
        onReconciled={() => setStockRevision((current) => current + 1)}
      />
      <div aria-live="polite">
        {query.loading && <LoadingState label="กำลังโหลดข้อมูลสต็อก" />}
        {query.error && <ErrorState message={query.error} />}
        {query.data && (
          <section className="surface">
            <div className="section-heading"><div><h2>{formatThaiDate(query.data.date)}</h2><span>สรุปความเคลื่อนไหวรายสินค้า</span></div></div>
            <StockSummaryTable items={query.data.items.filter((item) => item.active || item.stockNow > 0)} editable={isToday} pending={mutation.pending} onAdjust={handleAdjust} onCorrect={setCorrectionItem} />
          </section>
        )}
      </div>
      <StockPlansPanel plans={plans.data} products={query.data?.items ?? []} loading={plans.loading} error={plans.error} editable={isToday} today={today} onChanged={refreshPlansAndStock} />
      {correctionItem && <HistoricalCorrectionModal item={correctionItem} date={date} onClose={() => setCorrectionItem(null)} onSaved={() => { setCorrectionItem(null); setCorrectionSuccess('ปรับยอดย้อนหลังแล้ว'); setStockRevision((current) => current + 1); }} />}
    </section>
  );
}
