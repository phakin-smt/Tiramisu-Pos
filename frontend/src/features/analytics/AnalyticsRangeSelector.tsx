import type { AnalyticsRange } from '../../types/analytics';

const ranges: AnalyticsRange[] = [1, 7, 30];

export function AnalyticsRangeSelector({ value, onChange }: { value: AnalyticsRange; onChange(value: AnalyticsRange): void }) {
  return (
    <div className="segmented-control" aria-label="ช่วงเวลาวิเคราะห์">
      {ranges.map((range) => (
        <button key={range} type="button" aria-pressed={value === range} onClick={() => onChange(range)}>
          {range} วัน
        </button>
      ))}
    </div>
  );
}
