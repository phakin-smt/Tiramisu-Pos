import { describe, expect, it } from 'vitest';

import { analyticsRangeError, daysInRange, defaultCustomRange } from './analyticsRange';

describe('analytics range', () => {
  it('counts both ends of a range', () => {
    expect(daysInRange('2026-08-16', '2026-08-16')).toBe(1);
    expect(daysInRange('2026-02-27', '2026-03-01')).toBe(3);
  });

  it('accepts a range that ends today', () => {
    expect(analyticsRangeError('2026-08-01', '2026-08-16', '2026-08-16')).toBe('');
  });

  it('rejects what the backend would reject', () => {
    expect(analyticsRangeError('', '2026-08-16', '2026-08-16')).not.toBe('');
    expect(analyticsRangeError('2026-08-10', '2026-08-09', '2026-08-16')).toBe('วันเริ่มต้องไม่เกินวันสิ้นสุด');
    expect(analyticsRangeError('2026-08-10', '2026-08-17', '2026-08-16')).toBe('เลือกวันที่ไม่เกินวันนี้');
    expect(analyticsRangeError('2025-08-15', '2026-08-16', '2026-08-16')).toBe('เลือกช่วงได้ไม่เกิน 366 วัน');
    expect(analyticsRangeError('2025-08-16', '2026-08-16', '2026-08-16')).toBe('');
  });

  it('starts a custom range on the last seven days', () => {
    expect(defaultCustomRange('2026-08-16')).toEqual({ start: '2026-08-10', end: '2026-08-16' });
  });
});
