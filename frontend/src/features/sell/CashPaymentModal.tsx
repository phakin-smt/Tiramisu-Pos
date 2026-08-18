import { useEffect, useMemo, useState } from 'react';

import { formatCurrency } from '../../domain/format';

interface CashPaymentModalProps {
  open: boolean;
  amount: number;
  checkoutError: string;
  submitting: boolean;
  onClose(): void;
  onConfirm(): void;
}

const CASH_PRESETS = [100, 500, 1000] as const;

export function CashPaymentModal({ open, amount, checkoutError, submitting, onClose, onConfirm }: CashPaymentModalProps) {
  const [received, setReceived] = useState('');

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('cash-payment-open');
    return () => document.body.classList.remove('cash-payment-open');
  }, [open]);
  useEffect(() => {
    if (!open || submitting) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open, submitting]);

  const receivedAmount = Number(received);
  const validReceived = received !== '' && Number.isFinite(receivedAmount) && receivedAmount >= amount;
  const change = validReceived ? receivedAmount - amount : 0;
  const presets = useMemo(() => CASH_PRESETS.filter((preset) => preset >= amount), [amount]);

  if (!open) return null;
  return <div className="cash-payment-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <section className="cash-payment-modal" role="dialog" aria-modal="true" aria-labelledby="cash-payment-title">
      <header><div><h2 id="cash-payment-title">รับชำระเงินสด</h2><span>ตรวจสอบยอดก่อนยืนยันออเดอร์</span></div><button type="button" className="icon-button" aria-label="ปิดรับชำระเงินสด" disabled={submitting} onClick={onClose}>×</button></header>
      <div className="cash-payment-content">
        <div className="cash-total"><span>ยอดชำระ</span><strong>{formatCurrency(amount)}</strong></div>
        <label className="cash-received-field"><span>รับเงินมา</span><div><span aria-hidden="true">฿</span><input autoFocus aria-label="จำนวนเงินที่รับ" type="number" min="0" step="0.01" inputMode="decimal" value={received} disabled={submitting} onChange={(event) => setReceived(event.target.value)} /></div></label>
        <div className="cash-quick-buttons" aria-label="จำนวนเงินด่วน"><button type="button" disabled={submitting} onClick={() => setReceived(String(amount))}>Exact</button>{presets.map((preset) => <button key={preset} type="button" disabled={submitting} onClick={() => setReceived(String(preset))}>{preset}</button>)}</div>
        <div className={`cash-change${validReceived ? ' is-ready' : ''}`} aria-live="polite"><span>เงินทอน</span><strong>{formatCurrency(change)}</strong></div>
        {checkoutError && <div className="qr-status is-error" role="alert">{checkoutError}</div>}
      </div>
      <footer><button type="button" className="secondary-button" disabled={submitting} onClick={onClose}>ยกเลิก</button><button type="button" className="primary-button" aria-label="ยืนยันรับเงิน" disabled={!validReceived || submitting} onClick={onConfirm}>{submitting ? 'กำลังบันทึก...' : 'ยืนยันรับเงิน'}</button></footer>
    </section>
  </div>;
}
