import { describe, expect, it } from 'vitest';
import { bangkokDateISO, formatThaiDate, formatThaiDateTime } from './date';

describe('bangkokDateISO', () => {
  it('advances the business date after Bangkok midnight before UTC rollover', () => {
    expect(bangkokDateISO(new Date('2026-08-16T17:01:00Z'))).toBe('2026-08-17');
  });

  it('keeps the Bangkok date on the following UTC date before Bangkok midnight', () => {
    expect(bangkokDateISO(new Date('2026-08-17T16:59:00Z'))).toBe('2026-08-17');
  });
});

describe('formatThaiDate', () => {
  it('formats a valid ISO business date', () => {
    expect(formatThaiDate('2026-08-18')).toMatch(/18.*2569/);
  });

  it.each([
    'Tue, 18 Aug 2026 00:00:00 GMT',
    'not-a-date',
    '2026-02-30',
  ])('returns an unexpected date value without throwing: %s', (value) => {
    expect(() => formatThaiDate(value)).not.toThrow();
    expect(formatThaiDate(value)).toBe(value);
  });

  it('uses a safe fallback for a missing date', () => {
    expect(formatThaiDate(null)).toBe('—');
  });
});

describe('formatThaiDateTime', () => {
  it('formats an ISO snapshot time in Bangkok time', () => {
    expect(formatThaiDateTime('2026-08-21T04:30:00.000Z')).toMatch(/21.*ส\.ค\..*11:30/);
  });

  it('uses a safe fallback for missing or unexpected values', () => {
    expect(formatThaiDateTime(null)).toBe('—');
    expect(formatThaiDateTime('unexpected')).toBe('unexpected');
  });
});
