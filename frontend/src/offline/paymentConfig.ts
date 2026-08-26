import { getOfflinePaymentConfig } from '../api/offlinePaymentConfig';
import {
  PROMPTPAY_CONFIG_KEY,
  openBaannoiPosDatabase,
  type OfflinePaymentConfigRecord,
} from './database';

export const OFFLINE_PROMPTPAY_CONFIG_MISSING_MESSAGE = 'ยังไม่ได้เตรียมพร้อมเพย์สำหรับใช้งานออฟไลน์';
export const OFFLINE_PROMPTPAY_CONFIG_GUIDANCE = 'กรุณาเชื่อมต่ออินเทอร์เน็ตและเข้าสู่ระบบอย่างน้อย 1 ครั้ง';

export async function replaceOfflinePaymentConfig(
  merchantAccountInfo: string,
  version: number,
  provisionedAt = new Date().toISOString(),
): Promise<OfflinePaymentConfigRecord> {
  const record: OfflinePaymentConfigRecord = {
    key: PROMPTPAY_CONFIG_KEY,
    merchantAccountInfo,
    version,
    provisionedAt,
  };
  const database = await openBaannoiPosDatabase();
  try {
    await database.put('offlinePaymentConfig', record);
    return record;
  } finally {
    database.close();
  }
}

export async function readOfflinePaymentConfig(): Promise<OfflinePaymentConfigRecord | null> {
  const database = await openBaannoiPosDatabase();
  try {
    return await database.get('offlinePaymentConfig', PROMPTPAY_CONFIG_KEY) ?? null;
  } finally {
    database.close();
  }
}

export async function provisionOfflinePaymentConfig(): Promise<OfflinePaymentConfigRecord | null> {
  const response = await getOfflinePaymentConfig();
  if (!response.configured || !response.merchantAccountInfo) return null;
  return replaceOfflinePaymentConfig(response.merchantAccountInfo, response.version);
}
