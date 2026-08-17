import { formatCurrency } from '../../domain/format';

interface MobileCartBarProps { count: number; total: number; expanded: boolean; onOpen(): void; }
export function MobileCartBar({ count, total, expanded, onOpen }: MobileCartBarProps) {
  return <button type="button" className="mobile-cart-bar" aria-controls="sell-cart" aria-expanded={expanded} aria-label={`เปิดตะกร้า ${count} ชิ้น ยอดชำระ ${formatCurrency(total)}`} onClick={onOpen}>
    <span><strong>ตะกร้า</strong><small>{count} ชิ้น</small></span><strong>{formatCurrency(total)}</strong>
  </button>;
}
