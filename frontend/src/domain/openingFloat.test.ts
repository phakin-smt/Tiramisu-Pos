import { describe, expect, it } from 'vitest';

import { countedTotal, countOf, toCountDrafts, toDenominationCounts } from './openingFloat';

describe('opening float count', () => {
  it('reads only plain counts', () => {
    expect(countOf(' 12 ')).toBe(12);
    for (const raw of ['', '-3', 'abc', '1.5', '12345']) expect(countOf(raw)).toBe(0);
  });

  it('adds up the counted notes and coins', () => {
    expect(countedTotal({ 1000: '2', 100: '5', 5: '20', 50: 'abc' })).toBe(2600);
    expect(countedTotal({})).toBe(0);
  });

  it('saves only the faces that were counted', () => {
    expect(toDenominationCounts({ 500: '3', 20: '4', 10: '0', 50: 'x' })).toEqual({ '500': 3, '20': 4 });
    expect(toDenominationCounts({ 100: '' })).toBeNull();
  });

  it('refills the fields from a saved count and drops what it does not know', () => {
    expect(toCountDrafts({ '500': 3, '20': 4, '25': 2, '100': -1, '1': 1.5 })).toEqual({ 500: '3', 20: '4' });
    expect(toCountDrafts(null)).toEqual({});
  });

  it('round-trips a count unchanged', () => {
    const drafts = { 1000: '1', 100: '7', 2: '9' };
    expect(toCountDrafts(toDenominationCounts(drafts))).toEqual(drafts);
  });
});
