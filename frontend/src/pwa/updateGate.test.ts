import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasPendingServiceWorkerUpdate,
  isCheckoutActive,
  queueServiceWorkerUpdate,
  resetServiceWorkerUpdateGate,
  setCheckoutActive,
} from './updateGate';

beforeEach(() => resetServiceWorkerUpdateGate());

describe('service worker update gate', () => {
  it('applies an update immediately when the till is idle', () => {
    const apply = vi.fn();
    queueServiceWorkerUpdate(apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(hasPendingServiceWorkerUpdate()).toBe(false);
  });

  it('holds the update while a checkout is active and applies it once idle', () => {
    const apply = vi.fn();
    setCheckoutActive(true);
    queueServiceWorkerUpdate(apply);

    expect(apply).not.toHaveBeenCalled();
    expect(hasPendingServiceWorkerUpdate()).toBe(true);

    setCheckoutActive(false);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(hasPendingServiceWorkerUpdate()).toBe(false);
  });

  it('does not reload again on later idle transitions', () => {
    const apply = vi.fn();
    setCheckoutActive(true);
    queueServiceWorkerUpdate(apply);
    setCheckoutActive(false);
    setCheckoutActive(true);
    setCheckoutActive(false);

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('keeps holding across repeated activity while a sale continues', () => {
    const apply = vi.fn();
    setCheckoutActive(true);
    queueServiceWorkerUpdate(apply);
    setCheckoutActive(true);
    setCheckoutActive(true);

    expect(apply).not.toHaveBeenCalled();
    expect(isCheckoutActive()).toBe(true);
  });

  it('applies only the newest queued update', () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    setCheckoutActive(true);
    queueServiceWorkerUpdate(stale);
    queueServiceWorkerUpdate(fresh);
    setCheckoutActive(false);

    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the till goes idle without a queued update', () => {
    setCheckoutActive(true);
    expect(() => setCheckoutActive(false)).not.toThrow();
    expect(hasPendingServiceWorkerUpdate()).toBe(false);
  });
});
