import type { PaymentMethod } from '../../types/checkout';

export type { PaymentMethod } from '../../types/checkout';

interface PaymentSelectorProps {
  value: PaymentMethod;
  cashDisabled: boolean;
  promptPayDisabled: boolean;
  onActivate(value: PaymentMethod): void;
}

export function PaymentSelector({ value, cashDisabled, promptPayDisabled, onActivate }: PaymentSelectorProps) {
  return <fieldset className="cart-fieldset payment-fieldset"><legend>วิธีชำระ</legend><div className="cart-option-grid payment-options">
    <button type="button" aria-pressed={value === 'cash'} disabled={cashDisabled} onClick={() => onActivate('cash')}><span aria-hidden="true">฿</span><strong>เงินสด</strong></button>
    <button type="button" aria-pressed={value === 'transfer'} disabled={promptPayDisabled} onClick={() => onActivate('transfer')}><span aria-hidden="true">▦</span><strong>QR พร้อมเพย์</strong></button>
  </div></fieldset>;
}
