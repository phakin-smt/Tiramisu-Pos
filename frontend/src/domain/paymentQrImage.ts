/**
 * Turning a photograph or screenshot of a shop's QR into something a phone
 * camera can still read.
 *
 * A menu picture only has to look right, so it is shrunk hard and encoded
 * lossily. A QR has to be *decoded*, across a counter, by whatever phone the
 * customer happens to be holding. Two things follow, and they are the only
 * reasons this is not just shrinkImageForUpload with different numbers:
 *
 * PNG first, not WebP. The finder patterns and timing rows are exactly the
 * high-contrast edges a lossy encoder spends its budget on; ringing there costs
 * a scan, and a failed scan at the till costs far more than the kilobytes.
 *
 * 1000px, not 600px. A QR carrying a merchant payload is a denser grid than a
 * menu card, and the modules have to survive being resampled onto a screen and
 * then sampled again by a camera.
 *
 * JPEG is the fallback and it is a real compromise, taken only when a lossless
 * copy will not fit -- which in practice means a camera original of an already
 * printed QR rather than a clean screenshot.
 */

import { dataUriByteLength, dataUriContentType, drawToCanvas } from './productImage';

/** Matches PAYMENT_QR_MAX_BYTES on the server. */
export const MAX_QR_UPLOAD_BYTES = 600 * 1024;

/** Dense enough that the modules survive a screen and a camera in between. */
export const QR_LONGEST_SIDE = 1000;

/** Only reached when lossless will not fit, and kept high on purpose. */
const JPEG_QUALITY_STEPS = [0.95, 0.88, 0.8];

export async function prepareQrForUpload(file: Blob): Promise<string> {
  const canvas = await drawToCanvas(file, QR_LONGEST_SIDE);

  const lossless = canvas.toDataURL('image/png');
  if (dataUriContentType(lossless) === 'image/png' && dataUriByteLength(lossless) <= MAX_QR_UPLOAD_BYTES) {
    return lossless;
  }

  let smallest = dataUriContentType(lossless) === 'image/png' ? lossless : '';
  for (const quality of JPEG_QUALITY_STEPS) {
    const encoded = canvas.toDataURL('image/jpeg', quality);
    if (dataUriContentType(encoded) !== 'image/jpeg') break;
    if (dataUriByteLength(encoded) <= MAX_QR_UPLOAD_BYTES) return encoded;
    if (!smallest || dataUriByteLength(encoded) < dataUriByteLength(smallest)) smallest = encoded;
  }

  if (smallest) throw new Error('รูป QR ใหญ่เกินไป ลองถ่ายใหม่หรือครอบให้เหลือเฉพาะ QR');
  throw new Error('เบราว์เซอร์นี้เตรียมรูป QR ไม่ได้');
}
