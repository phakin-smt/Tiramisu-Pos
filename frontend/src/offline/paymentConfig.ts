import { getOfflinePaymentConfig, type PaymentMode } from '../api/offlinePaymentConfig';
import { getStorePaymentQrBlob } from '../api/storePaymentQr';
import {
  PROMPTPAY_CONFIG_KEY,
  openPromttakPosDatabase,
  type OfflinePaymentConfigRecord,
} from './database';

export const OFFLINE_PROMPTPAY_CONFIG_MISSING_MESSAGE = 'ยังไม่ได้เตรียมพร้อมเพย์สำหรับใช้งานออฟไลน์';
export const OFFLINE_PROMPTPAY_CONFIG_GUIDANCE = 'กรุณาเชื่อมต่ออินเทอร์เน็ตและเข้าสู่ระบบอย่างน้อย 1 ครั้ง';

export async function putOfflinePaymentConfig(
  record: OfflinePaymentConfigRecord,
): Promise<OfflinePaymentConfigRecord> {
  const database = await openPromttakPosDatabase();
  try {
    await database.put('offlinePaymentConfig', record);
    return record;
  } finally {
    database.close();
  }
}

export async function replaceOfflinePaymentConfig(
  merchantAccountInfo: string,
  version: number,
  provisionedAt = new Date().toISOString(),
  storeId?: number,
): Promise<OfflinePaymentConfigRecord> {
  return putOfflinePaymentConfig({
    key: PROMPTPAY_CONFIG_KEY,
    storeId,
    version,
    mode: 'promptpay',
    merchantAccountInfo,
    provisionedAt,
  });
}

/**
 * The provisioned receiver for `storeId`, or null when this device holds
 * somebody else's.
 *
 * Refusing another shop's record is the entire reason the store id is stored
 * with it. A till that switched shops while offline would otherwise show the
 * previous shop's QR, and the customer's transfer would land in that shop's
 * account -- with nothing at the counter to show for it until the day is
 * reconciled short. Being told there is no QR is recoverable; being paid into
 * the wrong account is not.
 *
 * A record written before shops had their own QR carries no id and belongs to
 * the first store, the only one it could have been provisioned for.
 */
export async function readOfflinePaymentConfig(
  storeId?: number,
): Promise<OfflinePaymentConfigRecord | null> {
  const database = await openPromttakPosDatabase();
  try {
    const record = await database.get('offlinePaymentConfig', PROMPTPAY_CONFIG_KEY) ?? null;
    if (!record) return null;
    if (storeId !== undefined && (record.storeId ?? 1) !== storeId) return null;
    return record;
  } finally {
    database.close();
  }
}

/**
 * Fetches how this shop is paid and keeps whatever the till will need offline.
 *
 * In image mode that means the picture's own bytes: there is no payload to
 * rebuild it from later. Failing to fetch them leaves the device with no
 * config at all rather than a config it cannot draw.
 */
export async function provisionOfflinePaymentConfig(
  storeId?: number,
): Promise<OfflinePaymentConfigRecord | null> {
  const response = await getOfflinePaymentConfig();
  const mode: PaymentMode = response.mode ?? (response.configured ? 'promptpay' : 'none');

  if (mode === 'image' && response.imageUrl) {
    const blob = await getStorePaymentQrBlob(response.imageUrl);
    return putOfflinePaymentConfig({
      key: PROMPTPAY_CONFIG_KEY,
      storeId,
      version: response.version,
      mode: 'image',
      merchantAccountInfo: '',
      imageChecksum: response.imageChecksum,
      imageType: blob.type || 'image/png',
      imageData: await blob.arrayBuffer(),
      provisionedAt: new Date().toISOString(),
    });
  }

  if (mode === 'promptpay' && response.merchantAccountInfo) {
    return replaceOfflinePaymentConfig(
      response.merchantAccountInfo,
      response.version,
      new Date().toISOString(),
      storeId,
    );
  }

  // This shop has no way to take a transfer right now. A record already held for
  // *this* shop is kept: the server briefly answering 'none' -- a PROMPTPAY_ID
  // unset during a deploy, say -- should not strand a till that was selling
  // fine. A record held for a different shop is dropped, because that is the
  // case where keeping it means being paid into somebody else's account.
  const held = await readOfflinePaymentConfig();
  if (held && storeId !== undefined && (held.storeId ?? 1) !== storeId) {
    await clearOfflinePaymentConfig();
  }
  return null;
}

/** Drops the provisioned receiver when the device is signed out. */
export async function clearOfflinePaymentConfig(): Promise<void> {
  const database = await openPromttakPosDatabase();
  try {
    await database.delete('offlinePaymentConfig', PROMPTPAY_CONFIG_KEY);
  } finally {
    database.close();
  }
}
