import { useEffect, useMemo, useRef } from 'react';

import { formatThaiDate, formatTime } from '../../domain/date';
import { formatCurrency } from '../../domain/format';
import type { CloseDayClosure, CloseDayReport } from '../../types/reports';
import { ReportOrders } from '../reports/ReportOrders';
import { ReportProductMovements } from '../reports/ReportProductMovements';
import { ReportSummary } from '../reports/ReportSummary';

interface CloseDayModalProps {
  open: boolean;
  report: CloseDayReport | null;
  closedAt: string | null;
  closureStatusUnavailable: boolean;
  pending: boolean;
  error: string;
  confirmation: CloseDayClosure | null;
  onClose(): void;
  onConfirm(): void;
}

export function CloseDayModal({ open, report, closedAt, closureStatusUnavailable, pending, error, confirmation, onClose, onConfirm }: CloseDayModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const movements = useMemo(() => (report?.menuSummary ?? []).reduce(
    (totals, item) => ({
      sold: totals.sold + item.sold,
      giveaway: totals.giveaway + item.giveaway,
      waste: totals.waste + item.waste,
      remaining: totals.remaining + item.remaining,
    }),
    { sold: 0, giveaway: 0, waste: 0, remaining: 0 },
  ), [report]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add('close-day-open');
    cancelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.classList.remove('close-day-open');
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open || !report) return null;
  const alreadyClosed = Boolean(closedAt);

  return <div className="close-day-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <section ref={dialogRef} className="close-day-modal" role="dialog" aria-modal="true" aria-labelledby="close-day-title" aria-describedby="close-day-explanation">
      <header>
        <div><h2 id="close-day-title">สรุปและปิดยอดวันนี้</h2><span>{formatThaiDate(report.date)}</span></div>
        <button type="button" className="icon-button" aria-label="ปิดหน้าสรุปยอด" disabled={pending} onClick={onClose}>×</button>
      </header>
      <div className="close-day-content">
        <ReportSummary report={report} />

        <section className="close-day-cash" aria-labelledby="close-day-cash-title">
          <div className="section-heading"><div><h3 id="close-day-cash-title">เงินสดที่ควรมี</h3><span>เงินทอนตั้งต้นและยอดขายเงินสด</span></div></div>
          {report.openingFloat == null
            ? <p className="missing-opening-float">ยังไม่ได้ตั้งเงินทอน</p>
            : <dl className="expected-cash-lines"><div><dt>เงินทอนตั้งต้น</dt><dd>{formatCurrency(report.openingFloat)}</dd></div><div><dt>ยอดขายเงินสด</dt><dd>{formatCurrency(report.cashTotal)}</dd></div><div><dt>เงินสดที่ควรมี</dt><dd>{formatCurrency(report.expectedCash ?? report.openingFloat + report.cashTotal)}</dd></div></dl>}
        </section>

        <section className="close-day-section" aria-labelledby="close-day-orders-title">
          <div className="section-heading"><div><h3 id="close-day-orders-title">รายการออเดอร์</h3><span>{report.orderCount} ออเดอร์</span></div></div>
          <ReportOrders orders={report.orders} />
        </section>

        <section className="close-day-section" aria-labelledby="close-day-movements-title">
          <div className="section-heading"><div><h3 id="close-day-movements-title">ความเคลื่อนไหวสินค้า</h3><span>ข้อมูลจากรายงานของระบบ</span></div></div>
          <dl className="close-day-movement-totals">
            <div><dt>ขาย</dt><dd>{movements.sold}</dd></div>
            <div><dt>แถม</dt><dd>{movements.giveaway}</dd></div>
            <div><dt>เสีย</dt><dd>{movements.waste}</dd></div>
            <div><dt>คงเหลือ</dt><dd>{movements.remaining}</dd></div>
          </dl>
          <ReportProductMovements items={report.menuSummary} />
        </section>
      </div>
      <footer>
        <div className="close-day-confirmation-copy">
          {confirmation
            ? <strong className="close-day-success" role="status">บันทึกเวลาปิดยอดแล้ว {formatTime(confirmation.closedAt)} น. ยังรับออเดอร์เพิ่มได้</strong>
            : <strong>{alreadyClosed ? `ปิดยอดล่าสุด ${formatTime(closedAt)} น.` : 'ยังไม่ได้บันทึกเวลาปิดยอดวันนี้'}</strong>}
          {closureStatusUnavailable && !confirmation && <span role="status">ไม่สามารถโหลดเวลาปิดยอดล่าสุดได้</span>}
          <p id="close-day-explanation">การยืนยันจะบันทึกหรืออัปเดตเวลาปิดยอดวันนี้ และยังรับออเดอร์เพิ่มหลังจากนี้ได้</p>
          {alreadyClosed && !confirmation && <span>ยืนยันอีกครั้งเพื่ออัปเดตเวลาปิดยอดล่าสุด</span>}
          {error && <span className="close-day-error" role="alert">{error}</span>}
          {pending && <span role="status" aria-live="polite">กำลังบันทึกเวลาปิดยอด...</span>}
        </div>
        <div className="close-day-actions">
          <button ref={cancelRef} type="button" className="secondary-button" disabled={pending} onClick={onClose}>กลับไปขาย</button>
          <button type="button" className="primary-button" disabled={pending} onClick={onConfirm}>
            {pending ? 'กำลังบันทึก...' : alreadyClosed ? 'อัปเดตเวลาปิดยอด' : 'ยืนยันปิดยอดวันนี้'}
          </button>
        </div>
      </footer>
    </section>
  </div>;
}
