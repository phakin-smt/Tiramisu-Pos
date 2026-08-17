import { useEffect, useRef, useState } from 'react';
import type { StockAdjustmentReason, StockSummaryItem } from '../../types/stock';

interface CounterProps {
  itemName: string;
  label: string;
  value: number;
  stock: number;
  increaseReason: StockAdjustmentReason;
  decreaseReason: StockAdjustmentReason;
  disabled: boolean;
  onAdjust(reason: StockAdjustmentReason, quantity: number): Promise<boolean>;
}

function AdjustmentCounter({ itemName, label, value, stock, increaseReason, decreaseReason, disabled, onAdjust }: CounterProps) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  const committing = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);

  const commit = async () => {
    if (committing.current || disabled) return;
    const next = Number(draft);
    if (!Number.isInteger(next) || next < 0) {
      setDraft(String(value));
      setError('กรุณากรอกจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
      return;
    }
    const difference = next - value;
    if (!difference) return;
    committing.current = true;
    setError('');
    await onAdjust(difference > 0 ? increaseReason : decreaseReason, Math.abs(difference));
    setDraft(String(value));
    committing.current = false;
  };

  const canDecrease = value > 0 && (decreaseReason !== 'undo_prepare' || stock > 0);
  const canIncrease = increaseReason === 'prepare' || stock > 0;
  return (
    <div className={`adjustment-counter ${increaseReason}`}>
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`ลด${label} ${itemName}`} disabled={disabled || !canDecrease} onClick={() => onAdjust(decreaseReason, 1)}>−</button>
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          aria-label={`จำนวน${label} ${itemName}`}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); void commit(); }
            if (event.key === 'Escape') { setDraft(String(value)); setError(''); event.currentTarget.blur(); }
          }}
        />
        <button type="button" aria-label={`เพิ่ม${label} ${itemName}`} disabled={disabled || !canIncrease} onClick={() => onAdjust(increaseReason, 1)}>+</button>
      </div>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

export function StockAdjustmentControls({ item, disabled, onAdjust }: { item: StockSummaryItem; disabled: boolean; onAdjust(reason: StockAdjustmentReason, quantity: number): Promise<boolean> }) {
  const run = (reason: StockAdjustmentReason, quantity: number) => onAdjust(reason, quantity);
  return (
    <div className="stock-adjustment-controls" aria-label={`ปรับจำนวน ${item.name}`}>
      <AdjustmentCounter itemName={item.name} label="เตรียมวันนี้" value={item.prepared} stock={item.stockNow} increaseReason="prepare" decreaseReason="undo_prepare" disabled={disabled} onAdjust={run} />
      <AdjustmentCounter itemName={item.name} label="แถมวันนี้" value={item.giveaway} stock={item.stockNow} increaseReason="giveaway" decreaseReason="undo_giveaway" disabled={disabled} onAdjust={run} />
      <AdjustmentCounter itemName={item.name} label="เสียวันนี้" value={item.waste} stock={item.stockNow} increaseReason="waste" decreaseReason="undo_waste" disabled={disabled} onAdjust={run} />
    </div>
  );
}
