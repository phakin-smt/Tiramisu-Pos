import { formatCurrency } from '../../domain/format';
import { STORE_TIRAMISU_DISCOUNT } from '../../domain/promotion';
import { acceptMoneyInput } from '../../domain/money';
import type { CartTotals as Totals, DiscountState } from '../../types/domain';

interface CartTotalsProps { totals: Totals; discountState: DiscountState; totalQuantity: number; paidQuantity: number; onDiscountChange(value: string): void; }

export function CartTotals({ totals, discountState, totalQuantity, paidQuantity, onDiscountChange }: CartTotalsProps) {
  const discountInput = discountState.manual ? discountState.value : totals.autoDiscount;
  return <section className="cart-totals" aria-label="ยอดรวมตะกร้า">
    <div><span>จำนวนทั้งหมด</span><strong>{totalQuantity} ชิ้น</strong></div>
    <div><span>จำนวนชำระ</span><strong>{paidQuantity} ชิ้น</strong></div>
    <div><span>ยอดรวม</span><strong>{formatCurrency(totals.subtotal)}</strong></div>
    <label className="discount-control"><span>ส่วนลด</span><span className="discount-input"><span aria-hidden="true">฿</span><input aria-label="ส่วนลด" type="text" inputMode="numeric" autoComplete="off" value={discountInput} onChange={(event) => onDiscountChange(acceptMoneyInput(event.target.value, String(discountInput), { satang: false }))} /></span></label>
    {totals.bundleSets > 0 && !discountState.manual && <p className="promotion-note" role="status">โปรฯ 69 บาท ครบ 3 ชิ้น ลดให้อัตโนมัติ {formatCurrency(totals.autoDiscount)}</p>}
    {totals.storeDiscount > 0 && !discountState.manual && <p className="promotion-note" role="status">ราคาร้านค้า · Tiramisu ลดชิ้นละ {STORE_TIRAMISU_DISCOUNT} บาท รวม {formatCurrency(totals.storeDiscount)}</p>}
    <div><span>VAT</span><strong>{formatCurrency(totals.vat)}</strong></div>
    <div className="grand-total"><span>ยอดชำระ</span><strong>{formatCurrency(totals.grandTotal)}</strong></div>
  </section>;
}
