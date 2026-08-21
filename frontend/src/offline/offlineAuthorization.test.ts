import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BAANNOI_POS_DATABASE_NAME, openBaannoiPosDatabase } from './database';
import { readOfflineAuthorization, refreshOfflineAuthorization } from './offlineAuthorization';

describe('offline trusted-device authorization', () => {
  beforeEach(async () => deleteDB(BAANNOI_POS_DATABASE_NAME));
  afterEach(async () => deleteDB(BAANNOI_POS_DATABASE_NAME));

  it('creates and refreshes a seven-day marker without persisting a PIN or secret', async () => {
    const enabled = new Date('2026-08-21T00:00:00.000Z');
    const record = await refreshOfflineAuthorization(enabled);
    expect(record).toEqual({
      key: 'offlineAuthorization', enabledAt: enabled.toISOString(),
      expiresAt: '2026-08-28T00:00:00.000Z', schemaVersion: 2,
    });
    expect(JSON.stringify(record).toLowerCase()).not.toMatch(/pin|secret|hash|cookie/);
    expect((await readOfflineAuthorization(new Date('2026-08-27T23:59:59.000Z'))).authorized).toBe(true);
  });

  it('reports missing and expired markers as unauthorized', async () => {
    expect(await readOfflineAuthorization()).toMatchObject({ authorized: false, reason: 'missing' });
    await refreshOfflineAuthorization(new Date('2026-08-01T00:00:00.000Z'));
    expect(await readOfflineAuthorization(new Date('2026-08-09T00:00:00.000Z'))).toMatchObject({ authorized: false, reason: 'expired' });
  });

  it('stores only the minimal authorization record in metadata', async () => {
    await refreshOfflineAuthorization(new Date('2026-08-21T00:00:00.000Z'));
    const database = await openBaannoiPosDatabase();
    const records = await database.getAll('metadata');
    database.close();
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0]).sort()).toEqual(['enabledAt', 'expiresAt', 'key', 'schemaVersion']);
  });
});
