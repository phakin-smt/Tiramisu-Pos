import { useState } from 'react';

import { analyticsRangeError, defaultCustomRange } from '../../domain/analyticsRange';
import type { AnalyticsPreset, AnalyticsRange } from '../../types/analytics';

const presets: AnalyticsPreset[] = [1, 7, 30];

interface Props {
  value: AnalyticsRange;
  today: string;
  onChange(value: AnalyticsRange): void;
}

export function AnalyticsRangeSelector({ value, today, onChange }: Props) {
  const custom = typeof value !== 'number';
  // The inputs keep what the owner typed, even while it is not yet a valid range.
  const [draft, setDraft] = useState(() => custom ? value : defaultCustomRange(today));
  const error = custom ? analyticsRangeError(draft.start, draft.end, today) : '';

  const changeDraft = (next: { start: string; end: string }) => {
    setDraft(next);
    if (!analyticsRangeError(next.start, next.end, today)) onChange(next);
  };

  return (
    <div className="analytics-range">
      <div className="segmented-control analytics-range-presets" aria-label="ช่วงเวลาวิเคราะห์">
        {presets.map((preset) => (
          <button key={preset} type="button" aria-pressed={value === preset} onClick={() => onChange(preset)}>
            {preset} วัน
          </button>
        ))}
        <button type="button" aria-pressed={custom} onClick={() => changeDraft(analyticsRangeError(draft.start, draft.end, today) ? defaultCustomRange(today) : draft)}>กำหนดเอง</button>
      </div>
      {custom && (
        <div className="analytics-range-dates">
          <label className="date-control"><span>ตั้งแต่</span><input type="date" value={draft.start} max={today} onChange={(event) => changeDraft({ ...draft, start: event.target.value })} /></label>
          <label className="date-control"><span>ถึง</span><input type="date" value={draft.end} max={today} onChange={(event) => changeDraft({ ...draft, end: event.target.value })} /></label>
          {error && <small className="analytics-range-error" role="alert">{error}</small>}
        </div>
      )}
    </div>
  );
}
