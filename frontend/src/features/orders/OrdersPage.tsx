import { useState } from 'react';
import { cancelOrder } from '../../api/orders';
import { ErrorState, LoadingState } from '../../components/AsyncState';
import { MutationFeedback } from '../../components/MutationFeedback';
import { PageHeader } from '../../components/PageHeader';
import { bangkokDateISO, formatThaiDate } from '../../domain/date';
import type { Order } from '../../types/orders';
import { useSafeMutation } from '../shared/useSafeMutation';
import { OrderList } from './OrderList';
import { useOrders } from './useOrders';

export function OrdersPage() {
  const today = bangkokDateISO();
  const [date, setDate] = useState(today);
  const [revision, setRevision] = useState(0);
  const orders = useOrders(date, revision);
  const cancellation = useSafeMutation();

  const requestCancellation = async (order: Order) => {
    const confirmed = window.confirm(`ยกเลิกออเดอร์ #${order.orderNumber} ใช่หรือไม่? สต็อกที่ตัดไปรวมของแถมจะถูกคืนอัตโนมัติ`);
    if (!confirmed) return;
    const result = await cancellation.run(() => cancelOrder(order.id), `ยกเลิกออเดอร์ #${order.orderNumber} แล้ว`);
    if (result) setRevision((current) => current + 1);
  };

  return <section className="data-page orders-page">
    <PageHeader title="ออเดอร์" />
    <div className="page-toolbar">
      <div><h2>ประวัติออเดอร์</h2><span>{orders.data ? `${orders.data.orders.length} ออเดอร์ · ${formatThaiDate(orders.data.date)}` : 'เลือกวันที่เพื่อดูรายการ'}</span></div>
      <label className="date-control"><span>วันที่ออเดอร์</span><input type="date" value={date} max={today} onChange={(event) => { if (event.target.value) { if (!cancellation.pending) cancellation.clear(); setDate(event.target.value); } }} /></label>
    </div>
    <MutationFeedback error={cancellation.error} success={cancellation.success} />
    <div aria-live="polite">
      {orders.loading && <LoadingState label="กำลังโหลดรายการออเดอร์" />}
      {orders.error && <ErrorState message={orders.error} />}
      {orders.data && <OrderList orders={orders.data.orders} cancellationPending={cancellation.pending} onCancel={requestCancellation} />}
    </div>
  </section>;
}
