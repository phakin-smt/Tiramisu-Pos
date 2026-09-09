import { describe, expect, it } from 'vitest';

import {
  dataUriByteLength,
  dataUriContentType,
  LONGEST_SIDE,
  MAX_UPLOAD_BYTES,
  targetDimensions,
} from './productImage';

describe('targetDimensions', () => {
  it('leaves a picture that already fits alone', () => {
    expect(targetDimensions(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('shrinks by the longest side, whichever way the photo is held', () => {
    expect(targetDimensions(3000, 2000)).toEqual({ width: 600, height: 400 });
    expect(targetDimensions(2000, 3000)).toEqual({ width: 400, height: 600 });
  });

  it('keeps the shape of the original', () => {
    const { width, height } = targetDimensions(4032, 3024);
    expect(width).toBe(LONGEST_SIDE);
    expect(width / height).toBeCloseTo(4032 / 3024, 2);
  });

  it('never rounds a very thin picture away to nothing', () => {
    const { width, height } = targetDimensions(4000, 3);
    expect(width).toBe(LONGEST_SIDE);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('treats a file that decoded to nothing as unusable', () => {
    expect(targetDimensions(0, 0)).toEqual({ width: 0, height: 0 });
    expect(targetDimensions(Number.NaN, 10)).toEqual({ width: 0, height: 0 });
  });
});

describe('dataUriContentType', () => {
  it('reads the format the canvas actually produced', () => {
    expect(dataUriContentType('data:image/webp;base64,AAAA')).toBe('image/webp');
    // Safari answers a request it cannot honour with a PNG rather than an error.
    expect(dataUriContentType('data:image/png;base64,AAAA')).toBe('image/png');
  });

  it('reports nothing for something that is not a data URI', () => {
    expect(dataUriContentType('/api/products/1/image?v=abc')).toBe('');
    expect(dataUriContentType('')).toBe('');
  });
});

describe('dataUriByteLength', () => {
  it('counts what the server will store, padding aside', () => {
    // "hi" is two bytes, encoded as four characters with two of padding.
    expect(dataUriByteLength('data:image/webp;base64,aGk=')).toBe(2);
    expect(dataUriByteLength('data:image/webp;base64,aGlp')).toBe(3);
  });

  it('agrees with the real length of a known payload', () => {
    const bytes = new Uint8Array(1000).fill(7);
    const encoded = btoa(String.fromCharCode(...bytes));
    expect(dataUriByteLength(`data:image/webp;base64,${encoded}`)).toBe(1000);
  });

  it('is nothing for an empty or malformed URI', () => {
    expect(dataUriByteLength('data:image/webp;base64,')).toBe(0);
    expect(dataUriByteLength('nonsense')).toBe(0);
  });

  it('measures the ceiling the server enforces in the same units', () => {
    const encoded = 'A'.repeat(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3));
    expect(dataUriByteLength(`data:image/webp;base64,${encoded}`)).toBeGreaterThanOrEqual(MAX_UPLOAD_BYTES);
  });
});
