import { useEffect, useState } from 'react';

import { formatCurrency } from '../../domain/format';

interface PromptPayModalProps {
  open: boolean;
  amount: number;
  localMode: boolean;
  qrUrl: string;
  loading: boolean;
  qrError: string;
  qrGuidance: string;
  checkoutError: string;
  submitting: boolean;
  onClose(): void;
  onConfirm(): void;
  onImageError(): void;
}

export function PromptPayModal({ open, amount, localMode, qrUrl, loading, qrError, qrGuidance, checkoutError, submitting, onClose, onConfirm, onImageError }: PromptPayModalProps) {
  // Readiness is tied to the URL that actually loaded, never reset by an effect:
  // a `load` event that lands before React flushes would otherwise be undone and
  // leave confirmation disabled with no second event to re-enable it.
  const [readyUrl, setReadyUrl] = useState('');
  const imageReady = Boolean(qrUrl) && readyUrl === qrUrl;
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('promptpay-open');
    return () => document.body.classList.remove('promptpay-open');
  }, [open]);
  useEffect(() => {
    if (!open || submitting) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open, submitting]);

  if (!open) return null;
  const confirmationDisabled = !qrUrl || !imageReady || submitting || Boolean(qrError);

  return <div className="promptpay-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <section className="promptpay-modal" role="dialog" aria-modal="true" aria-labelledby="promptpay-title">
      <header><div><h2 id="promptpay-title">QR พร้อมเพย์</h2><span>ยอดชำระ {formatCurrency(amount)}</span>{localMode && <span>Local Mode · สร้าง QR ในเครื่อง</span>}</div><button type="button" className="icon-button" aria-label="ปิด QR พร้อมเพย์" disabled={submitting} onClick={onClose}>×</button></header>
      <div className="promptpay-content">
        {loading && <div className="qr-status" role="status">กำลังสร้าง QR ตามยอด...</div>}
        {qrError && <div className="qr-status is-error" role="alert">{qrError}</div>}
        {qrGuidance && <div className="qr-status" role="status">{qrGuidance}</div>}
        {checkoutError && <div className="qr-status is-error" role="alert">{checkoutError}</div>}
        {qrUrl && <img src={qrUrl} alt={`QR พร้อมเพย์ ยอด ${amount.toFixed(2)} บาท`} onLoad={() => setReadyUrl(qrUrl)} onError={() => { setReadyUrl(''); onImageError(); }} />}
        {qrUrl && !imageReady && !qrError && <div className="qr-status" role="status">กำลังแสดง QR...</div>}
        {imageReady && <div className="qr-status" role="status">สแกนเพื่อชำระเงิน · กรุณาตรวจชื่อผู้รับก่อนยืนยันการโอน</div>}
      </div>
      <footer><button type="button" className="secondary-button" disabled={submitting} onClick={onClose}>ยกเลิก</button><button type="button" className="primary-button" disabled={confirmationDisabled} onClick={onConfirm}>{submitting ? 'กำลังบันทึก...' : 'ยืนยันว่าโอนแล้ว'}</button></footer>
    </section>
  </div>;
}
