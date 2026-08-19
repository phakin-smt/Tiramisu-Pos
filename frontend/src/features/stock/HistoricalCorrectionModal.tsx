import { useState } from 'react';
import { correctHistoricalStock } from '../../api/stock';
import { formatThaiDate } from '../../domain/date';
import type { StockSummaryItem } from '../../types/stock';
import { useSafeMutation } from '../shared/useSafeMutation';

export function HistoricalCorrectionModal({ item, date, onClose, onSaved }: { item: StockSummaryItem; date: string; onClose(): void; onSaved(): void }) {
  const [target, setTarget] = useState(String(item.stockNow));
  const [note, setNote] = useState('');
  const mutation = useSafeMutation();
  const parsed = Number(target); const valid = target !== '' && Number.isInteger(parsed) && parsed >= 0; const delta = valid ? parsed - item.stockNow : 0;
  const submit = async () => {
    if (!valid || !window.confirm(`ยืนยันปรับยอด ${item.name} วันที่ ${formatThaiDate(date)} จาก ${item.stockNow} ชิ้น เป็น ${parsed} ชิ้น ใช่หรือไม่?`)) return;
    const result = await mutation.run(() => correctHistoricalStock({ productId: item.productId, date, targetStock: parsed, note }), 'ปรับยอดย้อนหลังแล้ว');
    if (result) onSaved();
  };
  return <div className="historical-correction-overlay"><section role="dialog" aria-modal="true" aria-labelledby="historical-correction-title" className="historical-correction-modal"><h2 id="historical-correction-title">ปรับยอดย้อนหลัง</h2><p><strong>{item.name}</strong> · {formatThaiDate(date)}</p><p>ยอดปลายวันที่ระบบแสดง: <strong>{item.stockNow} ชิ้น</strong></p><label><span>ยอดที่ถูกต้อง</span><input autoFocus aria-label="ยอดที่ถูกต้อง" type="number" min="0" step="1" inputMode="numeric" value={target} onChange={(event) => setTarget(event.target.value)} /></label><label><span>หมายเหตุ</span><input aria-label="หมายเหตุ" value={note} onChange={(event) => setNote(event.target.value)} /></label>{valid && <p role="status">{delta < 0 ? `ปรับลด ${Math.abs(delta)} ชิ้น` : delta > 0 ? `ปรับเพิ่ม ${delta} ชิ้น` : 'ยอดไม่เปลี่ยนแปลง'}</p>}{mutation.error && <p role="alert">{mutation.error}</p>}<footer><button type="button" className="secondary-button" disabled={mutation.pending} onClick={onClose}>ยกเลิก</button><button type="button" className="primary-button" disabled={!valid || mutation.pending} onClick={() => void submit()}>ยืนยันปรับยอด</button></footer></section></div>;
}
