import { formatCurrency } from '../../domain/format';
import type { CartTotals as Totals, DiscountState } from '../../types/domain';

interface CartTotalsProps { totals: Totals; discountState: DiscountState; totalQuantity: number; paidQuantity: number; onDiscountChange(value: number): void; }

export function CartTotals({ totals, discountState, totalQuantity, paidQuantity, onDiscountChange }: CartTotalsProps) {
  const discountInput = discountState.manual ? discountState.value : totals.autoDiscount;
  return <section className="cart-totals" aria-label="ยอดรวมตะกร้า">
    <div><span>จำนวนทั้งหมด</span><strong>{totalQuantity} ชิ้น</strong></div>
    <div><span>จำนวนชำระ</span><strong>{paidQuantity} ชิ้น</strong></div>
    <div><span>ยอดรวม</span><strong>{formatCurrency(totals.subtotal)}</strong></div>
    <label className="discount-control"><span>ส่วนลด</span><span className="discount-input"><span aria-hidden="true">฿</span><input aria-label="ส่วนลด" type="number" min="0" step="1" value={discountInput} onChange={(event) => onDiscountChange(event.target.valueAsNumber)} /></span></label>
    {totals.bundleSets > 0 && !discountState.manual && <p className="promotion-note" role="status">โปรฯ 69 บาท ครบ 3 ชิ้น ลดให้อัตโนมัติ {formatCurrency(totals.autoDiscount)}</p>}
    <div><span>VAT</span><strong>{formatCurrency(totals.vat)}</strong></div>
    <div className="grand-total"><span>ยอดชำระ</span><strong>{formatCurrency(totals.grandTotal)}</strong></div>
  </section>;
}
