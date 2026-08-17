import { useState } from 'react';
import { EmptyState } from '../../components/AsyncState';
import { formatTime } from '../../domain/date';
import { formatCurrency } from '../../domain/format';
import type { Order } from '../../types/orders';
import { OrderDetails } from './OrderDetails';

const paymentLabels: Record<string, string> = { cash: 'เงินสด', transfer: 'โอน/พร้อมเพย์' };
const statusLabels: Record<string, string> = { completed: 'เสร็จสิ้น', cancelled: 'ยกเลิกแล้ว' };

interface Props {
  orders: Order[];
  cancellationPending: boolean;
  onCancel(order: Order): void;
}

export function OrderList({ orders, cancellationPending, onCancel }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  if (!orders.length) return <EmptyState message="ยังไม่มีออเดอร์ในวันที่เลือก" />;
  return <div className="order-list">{orders.map((order) => {
    const expanded = expandedId === order.id;
    const detailId = `order-details-${order.id}`;
    const itemCount = order.items.reduce((total, item) => total + item.qty, 0);
    return <article className={`order-card${order.status === 'cancelled' ? ' is-cancelled' : ''}`} key={order.id}>
      <div className="order-card-summary">
        <div className="order-identity"><strong>#{order.orderNumber}</strong><span>{formatTime(order.time)} · {itemCount} ชิ้น</span></div>
        <span className={`order-status ${order.status}`}>{statusLabels[order.status] ?? order.status}</span>
        <div className="order-payment"><strong>{formatCurrency(order.total)}</strong><span>{paymentLabels[order.paymentMethod] ?? order.paymentMethod}</span></div>
        <div className="order-actions">
          <button type="button" className="secondary-button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpandedId(expanded ? null : order.id)}>{expanded ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}</button>
          {order.status === 'completed' && <button type="button" className="danger-text-button" aria-label={`ยกเลิกออเดอร์ ${order.orderNumber}`} disabled={cancellationPending} onClick={() => onCancel(order)}>ยกเลิก</button>}
        </div>
      </div>
      {expanded && <div id={detailId}><OrderDetails order={order} /></div>}
    </article>;
  })}</div>;
}
