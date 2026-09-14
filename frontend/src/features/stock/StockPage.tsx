import { useRef, useState } from 'react';
import { adjustStock } from '../../api/stock';
import { ErrorState, LoadingState } from '../../components/AsyncState';
import { MutationFeedback } from '../../components/MutationFeedback';
import { PageHeader } from '../../components/PageHeader';
import { bangkokDateISO, formatThaiDate } from '../../domain/date';
import { applyStockAdjustment } from '../../domain/stockAdjustment';
import { StockDatePicker } from './StockDatePicker';
import { StockSummaryTable } from './StockSummaryTable';
import { StockPlansPanel } from './StockPlansPanel';
import { useStockSummary } from './useStockSummary';
import { useStockPlans } from './useStockPlans';
import type { StockAdjustmentReason } from '../../types/stock';
import type { StockSummaryItem } from '../../types/stock';
import { HistoricalCorrectionModal } from './HistoricalCorrectionModal';
import { StockReconciliationPanel } from './StockReconciliationPanel';
import { useStore } from '../stores/StoreContext';

const actionLabels: Record<StockAdjustmentReason, string> = {
  prepare: 'เตรียมเพิ่ม', undo_prepare: 'ยกเลิกเตรียม', giveaway: 'บันทึกแถม',
  undo_giveaway: 'ยกเลิกแถม', waste: 'บันทึกของเสีย', undo_waste: 'ยกเลิกของเสีย',
};

export function StockPage() {
  const { storeId } = useStore();
  const today = bangkokDateISO();
  const [date, setDate] = useState(today);
  const [stockRevision, setStockRevision] = useState(0);
  const [planRevision, setPlanRevision] = useState(0);
  const [correctionItem, setCorrectionItem] = useState<StockSummaryItem | null>(null);
  const [correctionSuccess, setCorrectionSuccess] = useState('');
  const query = useStockSummary(date, stockRevision);
  const plans = useStockPlans(planRevision);
  const [pendingProductIds, setPendingProductIds] = useState<ReadonlySet<number>>(() => new Set());
  const inFlight = useRef(new Set<number>());
  const [feedback, setFeedback] = useState({ error: '', success: '' });
  const isToday = date === today;

  // Each row locks on its own and patches itself from the server's answer, so
  // an adjustment never reloads or dims the rest of the table.
  const handleAdjust = async (productId: number, reason: StockAdjustmentReason, quantity: number) => {
    if (inFlight.current.has(productId)) return false;
    inFlight.current.add(productId);
    setPendingProductIds(new Set(inFlight.current));
    // Keep the last success line up while this one saves, so the bar does not collapse and jump the table.
    setFeedback((current) => ({ error: '', success: current.success }));
    try {
      const result = await adjustStock({ productId, reason, quantity });
      query.setData((summary) => summary.date !== today ? summary : {
        ...summary,
        items: summary.items.map((item) => item.productId === productId ? applyStockAdjustment(item, reason, quantity, result.stock) : item),
      });
      setFeedback({ error: '', success: `${actionLabels[reason]} ${quantity} ชิ้นแล้ว` });
      return true;
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ', success: '' });
      return false;
    } finally {
      inFlight.current.delete(productId);
      setPendingProductIds(new Set(inFlight.current));
    }
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
      <MutationFeedback error={feedback.error} success={feedback.success} />
      <MutationFeedback error="" success={correctionSuccess} />
      <StockReconciliationPanel
        storeId={storeId}
        serverStock={new Map((query.data?.items ?? []).map((item) => [item.productId, item.stockNow]))}
        onReconciled={() => setStockRevision((current) => current + 1)}
      />
      <div aria-live="polite">
        {query.loading && !query.data && <LoadingState label="กำลังโหลดข้อมูลสต็อก" />}
        {query.error && <ErrorState message={query.error} />}
        {query.data && (
          <section className="surface">
            <div className="section-heading"><div><h2>{formatThaiDate(query.data.date)}</h2><span>สรุปความเคลื่อนไหวรายสินค้า</span></div></div>
            <StockSummaryTable items={query.data.items.filter((item) => item.active || item.stockNow > 0)} editable={isToday} pendingProductIds={pendingProductIds} onAdjust={handleAdjust} onCorrect={setCorrectionItem} />
          </section>
        )}
      </div>
      <StockPlansPanel plans={plans.data} products={query.data?.items ?? []} loading={plans.loading} error={plans.error} editable={isToday} today={today} onChanged={refreshPlansAndStock} />
      {correctionItem && <HistoricalCorrectionModal item={correctionItem} date={date} onClose={() => setCorrectionItem(null)} onSaved={() => { setCorrectionItem(null); setCorrectionSuccess('ปรับยอดย้อนหลังแล้ว'); setStockRevision((current) => current + 1); }} />}
    </section>
  );
}
