import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BAANNOI_POS_DATABASE_NAME, openBaannoiPosDatabase } from './database';
import {
  provisionOfflinePaymentConfig,
  readOfflinePaymentConfig,
  replaceOfflinePaymentConfig,
} from './paymentConfig';

function json(body: unknown): Response {
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

describe('offline PromptPay configuration', () => {
  beforeEach(async () => deleteDB(BAANNOI_POS_DATABASE_NAME));
  afterEach(async () => {
    vi.unstubAllGlobals();
    await deleteDB(BAANNOI_POS_DATABASE_NAME);
  });

  it('stores only confirmed normalized merchant data and survives a later read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({
      configured: true,
      merchantAccountInfo: '0016A00000067701011101130066801234567',
      version: 1,
    })));
    const record = await provisionOfflinePaymentConfig();
    expect(await readOfflinePaymentConfig()).toEqual(record);
    expect(Object.keys(record!).sort()).toEqual(['key', 'merchantAccountInfo', 'provisionedAt', 'version']);
    expect(JSON.stringify(record).toLowerCase()).not.toMatch(/pin|secret|database|cookie|session/);
  });

  it.each(['request failure', 'unconfigured response'])('preserves previous valid config after %s', async (scenario) => {
    const previous = await replaceOfflinePaymentConfig('0016A00000067701011102131111111111111', 1, '2026-08-20T00:00:00.000Z');
    vi.stubGlobal('fetch', scenario === 'request failure'
      ? vi.fn().mockRejectedValue(new TypeError('network unavailable'))
      : vi.fn().mockResolvedValue(json({ configured: false, version: 1 })));
    if (scenario === 'request failure') await expect(provisionOfflinePaymentConfig()).rejects.toThrow('network unavailable');
    else expect(await provisionOfflinePaymentConfig()).toBeNull();
    expect(await readOfflinePaymentConfig()).toEqual(previous);
  });

  it('uses the dedicated IndexedDB store rather than metadata or localStorage', async () => {
    await replaceOfflinePaymentConfig('0016A00000067701011101130066801234567', 1);
    const database = await openBaannoiPosDatabase();
    expect(await database.count('offlinePaymentConfig')).toBe(1);
    expect(await database.get('metadata', 'promptpay')).toBeUndefined();
    database.close();
    expect(globalThis.localStorage?.getItem('promptpay') ?? null).toBeNull();
  });
});
