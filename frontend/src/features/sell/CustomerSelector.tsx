export type CustomerType = 'walkin' | 'member' | 'store';

interface CustomerSelectorProps { value: CustomerType; onChange(value: CustomerType): void; }
const options: Array<{ value: CustomerType; label: string }> = [
  { value: 'walkin', label: 'Walk-in' }, { value: 'member', label: 'สมาชิก' }, { value: 'store', label: 'ร้านค้า' },
];

export function CustomerSelector({ value, onChange }: CustomerSelectorProps) {
  return <fieldset className="cart-fieldset"><legend>ลูกค้า</legend><div className="cart-option-grid customer-options">
    {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div></fieldset>;
}
