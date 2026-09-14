import { addDaysISO } from './date';

export const ANALYTICS_MAX_DAYS = 366;

/** Inclusive day count between two ISO dates. */
export function daysInRange(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Returns the reason a custom range cannot be requested, or '' when it can. Mirrors the backend. */
export function analyticsRangeError(start: string, end: string, today: string): string {
  if (!start || !end) return 'กรุณาเลือกวันเริ่มและวันสิ้นสุด';
  if (start > end) return 'วันเริ่มต้องไม่เกินวันสิ้นสุด';
  if (end > today) return 'เลือกวันที่ไม่เกินวันนี้';
  if (daysInRange(start, end) > ANALYTICS_MAX_DAYS) return `เลือกช่วงได้ไม่เกิน ${ANALYTICS_MAX_DAYS} วัน`;
  return '';
}

export function defaultCustomRange(today: string) {
  return { start: addDaysISO(today, -6), end: today };
}
