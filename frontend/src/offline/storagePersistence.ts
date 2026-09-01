export type StoragePersistenceStatus = 'granted' | 'denied' | 'unsupported' | 'unknown';

export const STORAGE_NOT_PERSISTED_MESSAGE = 'อุปกรณ์นี้อาจลบข้อมูลออฟไลน์เมื่อพื้นที่เก็บข้อมูลเหลือน้อย';

/**
 * Asks the browser to keep our IndexedDB data out of its eviction pool.
 *
 * Until sync exists, IndexedDB holds the only copy of a day's takings, so an
 * eviction is unrecoverable. This never throws and never blocks: a browser that
 * lacks the API, or refuses the request, still gets a working POS — the caller
 * just learns that offline data is not durable.
 */
export async function requestPersistentStorage(): Promise<StoragePersistenceStatus> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';

  try {
    if (typeof storage.persisted === 'function' && await storage.persisted()) return 'granted';
    return await storage.persist() ? 'granted' : 'denied';
  } catch {
    // A present-but-broken API tells us nothing we can act on; treat it as absent.
    return 'unsupported';
  }
}

export function isStorageDurable(status: StoragePersistenceStatus): boolean {
  return status === 'granted';
}
