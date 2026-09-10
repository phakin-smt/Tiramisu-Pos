/**
 * Turning a photo from the camera roll into something worth storing.
 *
 * A picture straight off an iPad is several megabytes, and the server refuses
 * anything past 400KB. Shrinking here rather than there keeps that weight off
 * the shop's connection entirely: what leaves the till is already the size it
 * will be kept at.
 */

/** Matches PRODUCT_IMAGE_MAX_BYTES on the server. */
export const MAX_UPLOAD_BYTES = 400 * 1024;

/**
 * Big enough for a menu card on an iPad, small enough to be worth caching.
 *
 * 800 rather than 600 because the sell grid's photo box grew: the largest one is
 * 327 css px wide, which is 654 physical pixels on a 2x screen. A 4:3 photo
 * lands at 800x600 here, so the biggest tile is still sampling down rather than
 * stretching. Measured, not guessed -- see README, "รูปเมนู".
 */
export const LONGEST_SIDE = 800;

/** Tried in order until one fits under the ceiling. */
const QUALITY_STEPS = [0.82, 0.7, 0.55];

export function targetDimensions(width: number, height: number, longestSide = LONGEST_SIDE) {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return { width: 0, height: 0 };
  if (longest <= longestSide) return { width: Math.round(width), height: Math.round(height) };
  const scale = longestSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function dataUriContentType(dataUri: string): string {
  const comma = dataUri.indexOf(',');
  if (!dataUri.startsWith('data:') || comma < 0) return '';
  return dataUri.slice('data:'.length, comma).split(';')[0].trim().toLowerCase();
}

/** How many bytes the server will store, without decoding the whole string. */
export function dataUriByteLength(dataUri: string): number {
  const comma = dataUri.indexOf(',');
  if (comma < 0) return 0;
  const encoded = dataUri.slice(comma + 1);
  if (!encoded) return 0;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}

export async function drawToCanvas(file: Blob, longestSide = LONGEST_SIDE): Promise<HTMLCanvasElement> {
  const source = await createImageBitmap(file);
  try {
    const { width, height } = targetDimensions(source.width, source.height, longestSide);
    if (!width || !height) throw new Error('ไฟล์นี้ไม่ใช่รูปภาพ');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('เบราว์เซอร์นี้ย่อรูปไม่ได้');
    context.drawImage(source, 0, 0, width, height);
    return canvas;
  } finally {
    source.close?.();
  }
}

/**
 * Shrink a chosen photo into a data URI the upload endpoint accepts.
 *
 * WebP is asked for first and JPEG is the fallback, decided by what the canvas
 * actually hands back rather than by feature detection: a browser that cannot
 * encode WebP quietly returns a PNG, which would be larger than the original
 * rather than smaller.
 */
export async function shrinkImageForUpload(file: Blob): Promise<string> {
  const canvas = await drawToCanvas(file);
  const formats = ['image/webp', 'image/jpeg'];
  let smallest = '';

  for (const format of formats) {
    for (const quality of QUALITY_STEPS) {
      const encoded = canvas.toDataURL(format, quality);
      if (dataUriContentType(encoded) !== format) break; // Not supported; try the next format.
      if (dataUriByteLength(encoded) <= MAX_UPLOAD_BYTES) return encoded;
      if (!smallest || dataUriByteLength(encoded) < dataUriByteLength(smallest)) smallest = encoded;
    }
  }

  if (smallest) throw new Error('รูปนี้ใหญ่เกินไป ลองเลือกรูปอื่น');
  throw new Error('เบราว์เซอร์นี้ย่อรูปไม่ได้');
}
