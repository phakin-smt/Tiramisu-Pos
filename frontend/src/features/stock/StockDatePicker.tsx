export function StockDatePicker({ value, maximum, onChange }: { value: string; maximum: string; onChange(value: string): void }) {
  return <label className="date-control"><span>วันที่สต็อก</span><input type="date" value={value} max={maximum} onChange={(event) => onChange(event.target.value)} /></label>;
}
