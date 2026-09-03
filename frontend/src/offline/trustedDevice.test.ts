import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BAANNOI_POS_DATABASE_NAME, openBaannoiPosDatabase } from './database';
import {
  readOfflineAuthorization,
  refreshOfflineAuthorization,
  revokeOfflineAuthorization,
} from './offlineAuthorization';
import {
  clearOfflinePaymentConfig,
  readOfflinePaymentConfig,
  replaceOfflinePaymentConfig,
} from './paymentConfig';
import { recordOfflineCashSale } from './offlineOrders';
import { replaceConfirmedCatalogSnapshot } from './catalogSnapshot';

const PIN = '2468';
const merchantAccountInfo = '0016A00000067701011101130066801234567';

beforeEach(async () => { await deleteDB(BAANNOI_POS_DATABASE_NAME); });
afterEach(async () => { await deleteDB(BAANNOI_POS_DATABASE_NAME); });

/** Every value this device keeps on disk, flattened for inspection. */
async function dumpEverythingStored(): Promise<string> {
  const database = await openBaannoiPosDatabase();
  try {
    const dump: Record<string, unknown> = {};
    for (const store of [...database.objectStoreNames]) {
      dump[store] = await database.getAll(store as 'offlineOrders');
    }
    return JSON.stringify(dump);
  } finally {
    database.close();
  }
}

describe('trusted device authorization', () => {
  it('revokes offline authorization so a signed-out device cannot sell offline', async () => {
    await refreshOfflineAuthorization();
    expect((await readOfflineAuthorization()).authorized).toBe(true);

    await revokeOfflineAuthorization();

    const state = await readOfflineAuthorization();
    expect(state.authorized).toBe(false);
    expect(state.reason).toBe('missing');
    expect(state.record).toBeNull();
  });

  it('clears the provisioned PromptPay receiver on the same revocation', async () => {
    await replaceOfflinePaymentConfig(merchantAccountInfo, 1);
    expect(await readOfflinePaymentConfig()).not.toBeNull();

    await clearOfflinePaymentConfig();

    expect(await readOfflinePaymentConfig()).toBeNull();
  });

  it('blocks a local sale once authorization has been revoked', async () => {
    await replaceConfirmedCatalogSnapshot([
      { id: 1, code: 'ORI', barcode: null, name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 10, minStock: 2, active: true, icon: '🍰' },
    ], 1, '2026-08-21T07:00:00.000Z');
    await refreshOfflineAuthorization();
    await revokeOfflineAuthorization();

    await expect(recordOfflineCashSale({ storeId: 1,
      identity: {
        localOrderId: '550e8400-e29b-41d4-a716-446655440000',
        localOrderNumber: 'OFF-20260821-143522-0000',
        createdAt: '2026-08-21T07:35:22.000Z',
        businessDate: '2026-08-21',
      },
      idempotencyKey: 'aa11bb22-0000-4000-8000-00000000aaaa',
      order: { items: [{ productId: 1, qty: 1, giveawayQty: 0 }], paymentMethod: 'cash', customerType: 'walkin', discount: 0 },
      totals: { subtotal: 69, storeDiscount: 0, bundleSets: 0, autoDiscount: 0, discount: 0, vat: 0, grandTotal: 69 },
      amountTendered: 100,
      changeAmount: 31,
    })).rejects.toThrow('อุปกรณ์นี้ยังไม่พร้อมสำหรับการขายออฟไลน์');
  });

  it('revoking is safe to repeat and safe on a device that was never provisioned', async () => {
    await expect(revokeOfflineAuthorization()).resolves.toBeUndefined();
    await expect(clearOfflinePaymentConfig()).resolves.toBeUndefined();
    await refreshOfflineAuthorization();
    await revokeOfflineAuthorization();
    await expect(revokeOfflineAuthorization()).resolves.toBeUndefined();
    expect((await readOfflineAuthorization()).authorized).toBe(false);
  });

  it('stores no credential material anywhere on the device', async () => {
    await refreshOfflineAuthorization();
    await replaceOfflinePaymentConfig(merchantAccountInfo, 1);

    const stored = await dumpEverythingStored();

    // The PIN, and anything derived from it, must never reach disk.
    expect(stored).not.toContain(PIN);
    for (const forbidden of ['pin', 'Pin', 'PIN', 'password', 'secret', 'token', 'hash', 'salt', 'iterations']) {
      expect(stored).not.toContain(forbidden);
    }
    expect(globalThis.localStorage?.length ?? 0).toBe(0);
    expect(globalThis.sessionStorage?.length ?? 0).toBe(0);
  });

  it('keeps the authorization record to the minimum needed to authorize offline use', async () => {
    await refreshOfflineAuthorization();
    const database = await openBaannoiPosDatabase();
    const record = await database.get('metadata', 'offlineAuthorization');
    database.close();

    // Timestamps and a schema version only — nothing that can verify a person.
    expect(Object.keys(record ?? {}).sort()).toEqual(['enabledAt', 'expiresAt', 'key', 'schemaVersion']);
  });

  it('keeps unsynced sales through a revocation because they are revenue, not credentials', async () => {
    await replaceConfirmedCatalogSnapshot([
      { id: 1, code: 'ORI', barcode: null, name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 10, minStock: 2, active: true, icon: '🍰' },
    ], 1, '2026-08-21T07:00:00.000Z');
    await refreshOfflineAuthorization();
    await recordOfflineCashSale({ storeId: 1,
      identity: {
        localOrderId: '550e8400-e29b-41d4-a716-446655440001',
        localOrderNumber: 'OFF-20260821-143523-0001',
        createdAt: '2026-08-21T07:35:23.000Z',
        businessDate: '2026-08-21',
      },
      idempotencyKey: 'aa11bb22-0000-4000-8000-00000000bbbb',
      order: { items: [{ productId: 1, qty: 1, giveawayQty: 0 }], paymentMethod: 'cash', customerType: 'walkin', discount: 0 },
      totals: { subtotal: 69, storeDiscount: 0, bundleSets: 0, autoDiscount: 0, discount: 0, vat: 0, grandTotal: 69 },
      amountTendered: 100,
      changeAmount: 31,
    });

    await revokeOfflineAuthorization();

    const database = await openBaannoiPosDatabase();
    expect(await database.count('offlineOrders')).toBe(1);
    database.close();
  });
});
