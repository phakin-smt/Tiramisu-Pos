export type PaymentMethod = 'cash' | 'transfer';
interface PaymentSelectorProps { value: PaymentMethod; onChange(value: PaymentMethod): void; }

export function PaymentSelector({ value, onChange }: PaymentSelectorProps) {
  return <fieldset className="cart-fieldset payment-fieldset"><legend>วิธีชำระ</legend><div className="cart-option-grid payment-options">
    <button type="button" aria-pressed={value === 'cash'} onClick={() => onChange('cash')}><span aria-hidden="true">฿</span><strong>เงินสด</strong></button>
    <button type="button" aria-pressed={value === 'transfer'} onClick={() => onChange('transfer')}><span aria-hidden="true">▦</span><strong>QR พร้อมเพย์</strong></button>
  </div></fieldset>;
}
