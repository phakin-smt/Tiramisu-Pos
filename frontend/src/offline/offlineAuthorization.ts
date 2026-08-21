import {
  BAANNOI_POS_SCHEMA_VERSION,
  OFFLINE_AUTHORIZATION_KEY,
  openBaannoiPosDatabase,
  type OfflineAuthorizationRecord,
} from './database';

export const OFFLINE_AUTHORIZATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;
export const OFFLINE_AUTHORIZATION_REQUIRED_MESSAGE = 'อุปกรณ์นี้ยังไม่พร้อมสำหรับการขายออฟไลน์ กรุณาเชื่อมต่ออินเทอร์เน็ตและเข้าสู่ระบบก่อนใช้งาน';

export interface OfflineAuthorizationState {
  authorized: boolean;
  record: OfflineAuthorizationRecord | null;
  reason: 'missing' | 'expired' | null;
}

export async function refreshOfflineAuthorization(
  now = new Date(),
): Promise<OfflineAuthorizationRecord> {
  const database = await openBaannoiPosDatabase();
  const record: OfflineAuthorizationRecord = {
    key: OFFLINE_AUTHORIZATION_KEY,
    enabledAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OFFLINE_AUTHORIZATION_VALIDITY_MS).toISOString(),
    schemaVersion: BAANNOI_POS_SCHEMA_VERSION,
  };
  try {
    await database.put('metadata', record);
    return record;
  } finally {
    database.close();
  }
}

export async function readOfflineAuthorization(now = new Date()): Promise<OfflineAuthorizationState> {
  const database = await openBaannoiPosDatabase();
  try {
    const value = await database.get('metadata', OFFLINE_AUTHORIZATION_KEY);
    const record = value?.key === OFFLINE_AUTHORIZATION_KEY ? value : null;
    if (!record) return { authorized: false, record: null, reason: 'missing' };
    if (Date.parse(record.expiresAt) <= now.getTime()) {
      return { authorized: false, record, reason: 'expired' };
    }
    return { authorized: true, record, reason: null };
  } finally {
    database.close();
  }
}
