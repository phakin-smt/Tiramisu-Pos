import { useCallback, useEffect, useRef, useState } from 'react';

import { useConnectivity } from '../connectivity/ConnectivityContext';
import { syncPendingOfflineOrders, type OfflineSyncOutcome } from './syncOfflineOrders';

interface OfflineSyncState {
  syncing: boolean;
  lastOutcome: OfflineSyncOutcome | null;
  error: string;
}

const idleState: OfflineSyncState = { syncing: false, lastOutcome: null, error: '' };

/**
 * Drains the offline queue when the backend is genuinely reachable.
 *
 * Deliberately conservative: one drain at a time, never while a sale is in
 * progress, and never on a timer. It runs when the backend becomes reachable
 * and when explicitly asked — a failed drain waits for the next reconnect
 * rather than hammering a server that just told us no.
 */
export function useOfflineSync(unsyncedCount: number, busy: boolean, onSettled?: () => void) {
  const { isBackendOnline } = useConnectivity();
  const [state, setState] = useState<OfflineSyncState>(idleState);
  const running = useRef(false);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  // One attempt per reconnect: without this the effect would retry on every
  // render that follows a failure.
  const attemptedWhileOnline = useRef(false);

  const runSync = useCallback(async () => {
    if (running.current) return null;
    running.current = true;
    setState((current) => ({ ...current, syncing: true, error: '' }));
    try {
      const outcome = await syncPendingOfflineOrders();
      setState({ syncing: false, lastOutcome: outcome, error: outcome.error });
      return outcome;
    } catch (error) {
      setState({
        syncing: false,
        lastOutcome: null,
        error: error instanceof Error ? error.message : 'Sync ออเดอร์ออฟไลน์ไม่สำเร็จ',
      });
      return null;
    } finally {
      running.current = false;
      settled.current?.();
    }
  }, []);

  useEffect(() => {
    if (!isBackendOnline) {
      attemptedWhileOnline.current = false;
      return;
    }
    if (busy || unsyncedCount === 0 || attemptedWhileOnline.current) return;
    attemptedWhileOnline.current = true;
    void runSync();
  }, [busy, isBackendOnline, runSync, unsyncedCount]);

  return { ...state, runSync };
}
