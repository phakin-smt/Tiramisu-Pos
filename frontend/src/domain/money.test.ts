import { describe, expect, it } from 'vitest';

import { acceptMoneyInput, parseMoneyInput } from './money';

describe('money field input filter', () => {
  it('accepts digits and up to two decimal places', () => {
    for (const value of ['', '0', '5', '1250', '1250.5', '1250.50', '0.25', '999999']) {
      expect(acceptMoneyInput(value, 'previous')).toBe(value);
    }
  });

  it('keeps a trailing dot so satang can still be typed', () => {
    expect(acceptMoneyInput('12.', '12')).toBe('12.');
  });

  it('rejects anything that is not a plain amount, keeping what was there', () => {
    // type="number" would accept several of these and then report an empty value.
    for (const rejected of ['-1', '+5', 'abc', '1e5', '1E5', '1.234', '1..2', '1,250', ' 12', '12 ', '.5.5', '๑๒']) {
      expect(acceptMoneyInput(rejected, '99')).toBe('99');
    }
  });

  it('rejects a decimal point entirely when the field takes whole baht only', () => {
    expect(acceptMoneyInput('12', '5', { satang: false })).toBe('12');
    expect(acceptMoneyInput('', '5', { satang: false })).toBe('');
    for (const rejected of ['12.', '12.5', '-3', 'x']) {
      expect(acceptMoneyInput(rejected, '5', { satang: false })).toBe('5');
    }
  });

  it('treats a pasted valid amount the same as a typed one', () => {
    expect(acceptMoneyInput('1250.75', '')).toBe('1250.75');
    expect(acceptMoneyInput('฿1250', '')).toBe('');
  });
});

describe('money field parsing', () => {
  it('reads a filled amount', () => {
    expect(parseMoneyInput('0')).toBe(0);
    expect(parseMoneyInput('1250')).toBe(1250);
    expect(parseMoneyInput('1250.50')).toBe(1250.5);
  });

  it('reports a blank or half-typed amount as absent rather than zero', () => {
    // Zero and "not entered" must stay distinguishable: an unset opening float
    // is not the same as a float of nothing.
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('.')).toBeNull();
  });

  it('never returns a negative or non-finite amount', () => {
    expect(parseMoneyInput('-5')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
  });
});
