import { describe, expect, it } from 'vitest';
import { bangkokDateISO } from './date';

describe('bangkokDateISO', () => {
  it('advances the business date after Bangkok midnight before UTC rollover', () => {
    expect(bangkokDateISO(new Date('2026-08-16T17:01:00Z'))).toBe('2026-08-17');
  });

  it('keeps the Bangkok date on the following UTC date before Bangkok midnight', () => {
    expect(bangkokDateISO(new Date('2026-08-17T16:59:00Z'))).toBe('2026-08-17');
  });
});
