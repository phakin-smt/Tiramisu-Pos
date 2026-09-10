import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_QR_UPLOAD_BYTES, QR_LONGEST_SIDE, prepareQrForUpload } from './paymentQrImage';
import { MAX_UPLOAD_BYTES, LONGEST_SIDE } from './productImage';

/**
 * jsdom has neither createImageBitmap nor a canvas encoder, so both are stood in
 * for. What is being tested is the choice of format and the ceiling, not the
 * browser's encoding -- and that choice is the whole reason this exists next to
 * shrinkImageForUpload rather than being a call to it.
 */
function stubCanvas(encode: (type: string, quality?: number) => string, source = { width: 2400, height: 2400 }) {
  const drawn: { width: number; height: number } = { width: 0, height: 0 };
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ ...source, close: () => {} })));
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
    return {
      set width(value: number) { drawn.width = value; },
      get width() { return drawn.width; },
      set height(value: number) { drawn.height = value; },
      get height() { return drawn.height; },
      getContext: () => ({ drawImage: () => {} }),
      toDataURL: (type: string, quality?: number) => encode(type, quality),
    } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  return drawn;
}

/** A data URI whose decoded length is close to `bytes`. */
function sized(type: string, bytes: number) {
  return `data:${type};base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;
}

describe('prepareQrForUpload', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('keeps a QR lossless when it fits, rather than encoding it like a photo', async () => {
    const asked: string[] = [];
    stubCanvas((type) => { asked.push(type); return sized(type, 40 * 1024); });
    const encoded = await prepareQrForUpload(new Blob(['qr']));
    expect(encoded.startsWith('data:image/png;base64,')).toBe(true);
    // JPEG is never even offered while the lossless copy fits.
    expect(asked).toEqual(['image/png']);
  });

  it('draws a QR larger than a menu picture would be', async () => {
    const drawn = stubCanvas((type) => sized(type, 10 * 1024), { width: 3000, height: 3000 });
    await prepareQrForUpload(new Blob(['qr']));
    expect(drawn.width).toBe(QR_LONGEST_SIDE);
    expect(QR_LONGEST_SIDE).toBeGreaterThan(LONGEST_SIDE);
  });

  it('falls back to high quality JPEG only when lossless will not fit', async () => {
    const asked: Array<[string, number | undefined]> = [];
    stubCanvas((type, quality) => {
      asked.push([type, quality]);
      return sized(type, type === 'image/png' ? MAX_QR_UPLOAD_BYTES * 2 : 100 * 1024);
    });
    const encoded = await prepareQrForUpload(new Blob(['qr']));
    expect(encoded.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(asked[0][0]).toBe('image/png');
    // The first JPEG attempt is a high quality one: a QR degrades badly.
    expect(asked[1][1]).toBeGreaterThanOrEqual(0.9);
  });

  it('refuses a picture that will not fit at any quality rather than sending it', async () => {
    stubCanvas((type) => sized(type, MAX_QR_UPLOAD_BYTES * 2));
    await expect(prepareQrForUpload(new Blob(['qr']))).rejects.toThrow(/ใหญ่เกินไป/);
  });

  it('reports a browser that cannot encode at all', async () => {
    // A canvas that honours nothing answers with something else entirely.
    stubCanvas(() => 'data:image/gif;base64,AAAA');
    await expect(prepareQrForUpload(new Blob(['qr']))).rejects.toThrow(/เตรียมรูป QR ไม่ได้/);
  });

  it('allows a QR more room than a menu picture', () => {
    expect(MAX_QR_UPLOAD_BYTES).toBeGreaterThan(MAX_UPLOAD_BYTES);
  });
});
