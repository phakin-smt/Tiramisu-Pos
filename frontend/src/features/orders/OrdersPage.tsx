import { useMemo, useState } from 'react';
import { cancelOrder } from '../../api/orders';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState';
import { MutationFeedback } from '../../components/MutationFeedback';
import { PageHeader } from '../../components/PageHeader';
import { bangkokDateISO, formatThaiDate } from '../../domain/date';
import { formatCurrency } from '../../domain/format';
import { applyOrderFilters, DEFAULT_ORDER_FILTERS, hasActiveOrderFilters, summarizeOrders, type OrderFilters } from '../../domain/orderFilters';
import type { Order } from '../../types/orders';
import { useSafeMutation } from '../shared/useSafeMutation';
import { OrderFilterBar } from './OrderFilterBar';
import { OrderList } from './OrderList';
import { useOrders } from './useOrders';

export function OrdersPage() {
  const today = bangkokDateISO();
  const [date, setDate] = useState(today);
  const [revision, setRevision] = useState(0);
  // Kept across date changes: checking transfers is usually done day after day.
  const [filters, setFilters] = useState<OrderFilters>(DEFAULT_ORDER_FILTERS);
  const orders = useOrders(date, revision);
  const cancellation = useSafeMutation();
  const allOrders = orders.data?.orders;
  const visibleOrders = useMemo(() => (allOrders ? applyOrderFilters(allOrders, filters) : []), [allOrders, filters]);
  const summary = summarizeOrders(visibleOrders);
  const filtering = hasActiveOrderFilters(filters);

  const requestCancellation = async (order: Order) => {
    const confirmed = window.confirm(`ยกเลิกออเดอร์ #${order.orderNumber} ใช่หรือไม่? สต็อกที่ตัดไปรวมของแถมจะถูกคืนอัตโนมัติ`);
    if (!confirmed) return;
    const result = await cancellation.run(() => cancelOrder(order.id), `ยกเลิกออเดอร์ #${order.orderNumber} แล้ว`);
    if (result) setRevision((current) => current + 1);
  };
  const clearFilters = () => setFilters((current) => ({ ...DEFAULT_ORDER_FILTERS, sort: current.sort }));

  return <section className="data-page orders-page">
    <PageHeader title="ออเดอร์" />
    <div className="page-toolbar">
      <div><h2>ประวัติออเดอร์</h2><span>{orders.data ? `${orders.data.orders.length} ออเดอร์ · ${formatThaiDate(orders.data.date)}` : 'เลือกวันที่เพื่อดูรายการ'}</span></div>
      <label className="date-control"><span>วันที่ออเดอร์</span><input type="date" value={date} max={today} onChange={(event) => { if (event.target.value) { if (!cancellation.pending) cancellation.clear(); setDate(event.target.value); } }} /></label>
    </div>
    <OrderFilterBar filters={filters} onChange={setFilters} />
    <MutationFeedback error={cancellation.error} success={cancellation.success} />
    <div aria-live="polite">
      {orders.loading && <LoadingState label="กำลังโหลดรายการออเดอร์" />}
      {orders.error && <ErrorState message={orders.error} />}
      {allOrders && allOrders.length > 0 && <div className="order-filter-summary">
        <span>{filtering ? `แสดง ${summary.count} จาก ${allOrders.length} ออเดอร์` : `${summary.count} ออเดอร์`} · ยอดรับ <strong>{formatCurrency(summary.completedTotal)}</strong>{summary.completedCount < summary.count && ' (ไม่นับที่ยกเลิก)'}</span>
        {filtering && <button type="button" className="secondary-button" onClick={clearFilters}>ล้างตัวกรอง</button>}
      </div>}
      {allOrders && (allOrders.length > 0 && visibleOrders.length === 0
        ? <EmptyState message="ไม่มีออเดอร์ที่ตรงกับตัวกรอง" />
        : <OrderList orders={visibleOrders} cancellationPending={cancellation.pending} onCancel={requestCancellation} />)}
    </div>
  </section>;
}
