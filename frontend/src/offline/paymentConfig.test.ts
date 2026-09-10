import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROMTTAK_POS_DATABASE_NAME, openPromttakPosDatabase } from './database';
import {
  provisionOfflinePaymentConfig,
  readOfflinePaymentConfig,
  replaceOfflinePaymentConfig,
} from './paymentConfig';

function blob(body: string, type = 'image/png'): Response {
  const bytes = new TextEncoder().encode(body);
  // jsdom's Blob has no arrayBuffer(), and the record is stored as bytes.
  const payload = { type, arrayBuffer: async () => bytes.buffer } as unknown as Blob;
  return { ok: true, status: 200, headers: new Headers({ 'content-type': type }), blob: async () => payload } as Response;
}

function json(body: unknown): Response {
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

describe('offline PromptPay configuration', () => {
  beforeEach(async () => deleteDB(PROMTTAK_POS_DATABASE_NAME));
  afterEach(async () => {
    vi.unstubAllGlobals();
    await deleteDB(PROMTTAK_POS_DATABASE_NAME);
  });

  it('stores only confirmed normalized merchant data and survives a later read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({
      configured: true,
      merchantAccountInfo: '0016A00000067701011101130066801234567',
      version: 1,
    })));
    const record = await provisionOfflinePaymentConfig();
    expect(await readOfflinePaymentConfig()).toEqual(record);
    expect(Object.keys(record!).sort()).toEqual(['key', 'merchantAccountInfo', 'mode', 'provisionedAt', 'storeId', 'version']);
    expect(JSON.stringify(record).toLowerCase()).not.toMatch(/pin|secret|database|cookie|session/);
  });

  it.each(['request failure', 'unconfigured response'])('preserves previous valid config after %s', async (scenario) => {
    const previous = await replaceOfflinePaymentConfig('0016A00000067701011102131111111111111', 1, '2026-08-20T00:00:00.000Z', 1);
    vi.stubGlobal('fetch', scenario === 'request failure'
      ? vi.fn().mockRejectedValue(new TypeError('network unavailable'))
      : vi.fn().mockResolvedValue(json({ configured: false, version: 1 })));
    if (scenario === 'request failure') await expect(provisionOfflinePaymentConfig(1)).rejects.toThrow('network unavailable');
    else expect(await provisionOfflinePaymentConfig(1)).toBeNull();
    expect(await readOfflinePaymentConfig(1)).toEqual(previous);
  });


  it('refuses a receiver provisioned for another shop', async () => {
    await replaceOfflinePaymentConfig('0016A00000067701011102131111111111111', 1, '2026-08-20T00:00:00.000Z', 1);
    // The till still holds store 1's receiver; store 2 must be told it has none
    // rather than being handed it. Money into the wrong account is not
    // recoverable at the counter; an unavailable QR is.
    expect(await readOfflinePaymentConfig(2)).toBeNull();
    expect(await readOfflinePaymentConfig(1)).not.toBeNull();
  });

  it('treats a record written before shops had their own QR as belonging to the first shop', async () => {
    const database = await openPromttakPosDatabase();
    await database.put('offlinePaymentConfig', {
      key: 'promptpay',
      version: 1,
      merchantAccountInfo: '0016A00000067701011102131111111111111',
      provisionedAt: '2026-08-01T00:00:00.000Z',
    });
    database.close();
    expect(await readOfflinePaymentConfig(1)).not.toBeNull();
    expect(await readOfflinePaymentConfig(2)).toBeNull();
  });

  it('keeps the picture itself when the shop is paid through one', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/offline-payment-config') {
        return Promise.resolve(json({ configured: true, mode: 'image', imageUrl: '/api/store/payment-qr?v=abc', imageChecksum: 'abc', version: 1 }));
      }
      if (url === '/api/store/payment-qr?v=abc') return Promise.resolve(blob('qr-bytes'));
      throw new Error(`Unexpected request: ${url}`);
    }));
    const record = await provisionOfflinePaymentConfig(2);
    expect(record?.mode).toBe('image');
    expect(record?.storeId).toBe(2);
    // There is no payload to rebuild a photograph from, so the bytes are the
    // only thing that makes the till able to sell offline at all.
    expect(record?.imageData?.byteLength).toBeGreaterThan(0);
    expect(record?.merchantAccountInfo).toBe('');
    expect(await readOfflinePaymentConfig(1)).toBeNull();
  });

  it('drops a config held for another shop when this one has no way to take a transfer', async () => {
    await replaceOfflinePaymentConfig('0016A00000067701011102131111111111111', 1, '2026-08-20T00:00:00.000Z', 1);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ configured: false, mode: 'none', version: 1 })));
    expect(await provisionOfflinePaymentConfig(2)).toBeNull();
    // Not merely hidden from store 2 -- gone, so no later read can find it.
    expect(await readOfflinePaymentConfig()).toBeNull();
  });

  it('uses the dedicated IndexedDB store rather than metadata or localStorage', async () => {
    await replaceOfflinePaymentConfig('0016A00000067701011101130066801234567', 1);
    const database = await openPromttakPosDatabase();
    expect(await database.count('offlinePaymentConfig')).toBe(1);
    expect(await database.get('metadata', 'promptpay')).toBeUndefined();
    database.close();
    expect(globalThis.localStorage?.getItem('promptpay') ?? null).toBeNull();
  });
});
