import { formatCurrency } from '../../domain/format';
import type { Order } from '../../types/orders';

export function OrderDetails({ order }: { order: Order }) {
  return <div className="order-details">
    <div className="order-totals" aria-label={`ยอดรวมออเดอร์ ${order.orderNumber}`}>
      <span>ยอดก่อนส่วนลด <strong>{formatCurrency(order.subtotal)}</strong></span>
      <span>ส่วนลด <strong>{formatCurrency(order.discount)}</strong></span>
      <span>ยอดสุทธิ <strong>{formatCurrency(order.total)}</strong></span>
    </div>
    <div className="table-scroll"><table><caption className="visually-hidden">รายการสินค้าออเดอร์ {order.orderNumber}</caption><thead><tr><th>สินค้า</th><th>จำนวนรวม</th><th>จำนวนชำระ</th><th>ของแถม</th><th>ราคาต่อชิ้น</th><th>ยอดรายการ</th></tr></thead><tbody>{order.items.map((item, index) => {
      const paidQuantity = item.qty - item.giveawayQty;
      return <tr key={`${item.code}-${index}`}><td><strong>{item.name}</strong><small>{item.code}</small></td><td>{item.qty}</td><td>{paidQuantity}</td><td>{item.giveawayQty ? <span className="giveaway-label">แถม {item.giveawayQty}</span> : '0'}</td><td>{formatCurrency(item.unitPrice)}</td><td>{formatCurrency(item.lineTotal)}</td></tr>;
    })}</tbody></table></div>
  </div>;
}
