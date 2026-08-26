import { afterEach, describe, expect, it, vi } from 'vitest';

import { isStorageDurable, requestPersistentStorage } from './storagePersistence';

const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');

function stubStorage(value: unknown) {
  Object.defineProperty(navigator, 'storage', { configurable: true, value });
}

afterEach(() => {
  if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage);
  else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'storage');
});

describe('persistent storage request', () => {
  it('reports granted when the browser accepts the request', async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persist, persisted: async () => false });

    expect(await requestPersistentStorage()).toBe('granted');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('reports granted without asking again when storage is already persisted', async () => {
    const persist = vi.fn(async () => false);
    stubStorage({ persist, persisted: async () => true });

    expect(await requestPersistentStorage()).toBe('granted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports denied when the browser refuses the request', async () => {
    stubStorage({ persist: async () => false, persisted: async () => false });

    const status = await requestPersistentStorage();
    expect(status).toBe('denied');
    expect(isStorageDurable(status)).toBe(false);
  });

  it('reports unsupported on a browser without the Storage API', async () => {
    stubStorage(undefined);
    expect(await requestPersistentStorage()).toBe('unsupported');
  });

  it('reports unsupported when the API exists but has no persist method', async () => {
    stubStorage({ estimate: async () => ({}) });
    expect(await requestPersistentStorage()).toBe('unsupported');
  });

  it('never throws when the Storage API rejects', async () => {
    stubStorage({
      persist: async () => { throw new Error('permission database unavailable'); },
      persisted: async () => false,
    });

    await expect(requestPersistentStorage()).resolves.toBe('unsupported');
  });

  it('treats only a granted status as durable', () => {
    expect(isStorageDurable('granted')).toBe(true);
    expect(isStorageDurable('denied')).toBe(false);
    expect(isStorageDurable('unsupported')).toBe(false);
    expect(isStorageDurable('unknown')).toBe(false);
  });
});
