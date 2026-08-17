import { EmptyState } from '../../components/AsyncState';
import { formatTime } from '../../domain/date';
import { formatCurrency } from '../../domain/format';
import type { ReportOrder } from '../../types/reports';

const paymentLabels: Record<string, string> = { cash: 'เงินสด', transfer: 'โอน/พร้อมเพย์' };

export function ReportOrders({ orders }: { orders: ReportOrder[] }) {
  if (!orders.length) return <EmptyState message="ไม่มีออเดอร์ในวันที่เลือก" />;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>เวลา</th><th>เลขออเดอร์</th><th>ชำระ</th><th>รายการ</th><th>ส่วนลด</th><th>ยอดสุทธิ</th></tr></thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.orderNumber}>
              <td>{formatTime(order.time)}</td>
              <td>#{order.orderNumber}</td>
              <td>{paymentLabels[order.paymentMethod] ?? order.paymentMethod}</td>
              <td>{order.items.map((item) => <div key={`${item.code}-${item.name}`}>{item.name} × {item.qty}{item.giveawayQty ? ` (แถม ${item.giveawayQty})` : ''}</div>)}</td>
              <td>{formatCurrency(order.discount)}</td>
              <td>{formatCurrency(order.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
