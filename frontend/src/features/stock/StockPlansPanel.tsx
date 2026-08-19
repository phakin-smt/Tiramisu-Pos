import { useEffect, useState } from 'react';
import { cancelStockPlan, createStockPlan } from '../../api/stock';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState';
import { MutationFeedback } from '../../components/MutationFeedback';
import { addDaysISO, formatThaiDate } from '../../domain/date';
import type { StockPlan, StockSummaryItem } from '../../types/stock';
import { useSafeMutation } from '../shared/useSafeMutation';

interface Props {
  plans: StockPlan[] | null;
  products: StockSummaryItem[];
  loading: boolean;
  error: string;
  editable: boolean;
  today: string;
  onChanged(): void;
}

export function StockPlansPanel({ plans, products, loading, error, editable, today, onChanged }: Props) {
  const [productId, setProductId] = useState('');
  const [date, setDate] = useState(addDaysISO(today, 1));
  const [quantity, setQuantity] = useState('1');
  const mutation = useSafeMutation();

  useEffect(() => {
    if (!products.some((product) => String(product.productId) === productId)) {
      setProductId(products[0] ? String(products[0].productId) : '');
    }
  }, [products, productId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    if (!productId || !Number.isInteger(parsedQuantity) || parsedQuantity <= 0 || date < today) return;
    const result = await mutation.run(
      () => createStockPlan({ productId: Number(productId), date, quantity: parsedQuantity }),
      'สร้างแผนเตรียมสต็อกแล้ว',
    );
    if (result) { setQuantity('1'); onChanged(); }
  };

  const cancel = async (plan: StockPlan) => {
    if (!window.confirm(`ยกเลิกแผน ${plan.name} วันที่ ${formatThaiDate(plan.date)} ใช่หรือไม่?`)) return;
    const result = await mutation.run(() => cancelStockPlan(plan.id), 'ยกเลิกแผนแล้ว');
    if (result) onChanged();
  };

  return (
    <section className="surface stock-plans-panel">
      <div className="section-heading"><div><h2>แผนเตรียมสต็อก</h2><span>รายการที่รอดำเนินการจากเซิร์ฟเวอร์</span></div></div>
      {editable && (
        <form className="stock-plan-form" onSubmit={submit}>
          <label><span>สินค้า</span><select value={productId} onChange={(event) => setProductId(event.target.value)} required>{products.map((product) => <option key={product.productId} value={product.productId}>{product.name} ({product.code}){product.active ? '' : ' · พักขาย'}</option>)}</select></label>
          <label><span>วันที่เตรียม</span><input type="date" min={today} value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          <label><span>จำนวน</span><input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
          <button className="primary-button" type="submit" disabled={mutation.pending || !products.length || !productId || date < today}>เพิ่มแผน</button>
        </form>
      )}
      <MutationFeedback error={mutation.error} success={mutation.success} />
      {loading && <LoadingState label="กำลังโหลดแผนสต็อก" />}
      {error && <ErrorState message={error} />}
      {plans && !plans.length && <EmptyState message="ไม่มีแผนเตรียมสต็อกที่รอดำเนินการ" />}
      {!!plans?.length && <div className="compact-list stock-plan-list">{plans.map((plan) => <div key={plan.id}><span><strong>{plan.name}</strong><small>{plan.code} · {formatThaiDate(plan.date)} · {plan.quantity} ชิ้น</small></span><span className="plan-actions"><span className="status-label">รอดำเนินการ</span>{editable && <button type="button" className="danger-text-button" aria-label={`ยกเลิกแผน ${plan.name}`} disabled={mutation.pending} onClick={() => cancel(plan)}>ยกเลิก</button>}</span></div>)}</div>}
    </section>
  );
}
