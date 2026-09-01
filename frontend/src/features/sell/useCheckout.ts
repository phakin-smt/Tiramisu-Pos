import { useCallback, useRef, useState } from 'react';

import { createOrder } from '../../api/checkout';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import type { OfflineOrder } from '../../offline/database';
import {
  createClientUuid,
  createOfflineOrderIdentity,
  getUnsyncedOfflineOrderCount,
  recordOfflineSale,
  type OfflineSaleDetails,
} from '../../offline/offlineOrders';
import type { CreateOrderRequest, CreateOrderResponse } from '../../types/checkout';

interface CheckoutState {
  pending: boolean;
  error: string;
  response: CreateOrderResponse | null;
  offlineOrder: OfflineOrder | null;
}

/**
 * Identifies the sale a retry key belongs to: the goods, the customer and the
 * discount.
 *
 * Payment method is deliberately excluded. Switching cash to transfer for the
 * same basket is still the same sale, and keeping the key there is what makes an
 * already-committed order replay instead of being charged a second time.
 */
function saleFingerprint(payload: CreateOrderRequest): string {
  const items = payload.items
    .map((item) => `${item.productId}:${item.qty}:${item.giveawayQty}`)
    .sort();
  return JSON.stringify({ items, customerType: payload.customerType, discount: payload.discount });
}

export type CheckoutResult =
  | { mode: 'online'; response: CreateOrderResponse }
  | { mode: 'offline'; order: OfflineOrder };

export function useCheckout() {
  const { getSnapshot } = useConnectivity();
  const locked = useRef(false);
  const pendingServerKey = useRef<{ key: string; fingerprint: string } | null>(null);
  const pendingOfflineIdentity = useRef<ReturnType<typeof createOfflineOrderIdentity> | null>(null);
  const [state, setState] = useState<CheckoutState>({ pending: false, error: '', response: null, offlineOrder: null });

  const submit = useCallback(async (
    payload: CreateOrderRequest,
    localDetails?: OfflineSaleDetails,
  ): Promise<CheckoutResult | null> => {
    if (locked.current) return null;
    locked.current = true;
    setState({ pending: true, error: '', response: null, offlineOrder: null });

    // One key per sale, minted before the Cloud/Local decision. If an online POST
    // reached the server but its response was lost, the local order written on
    // retry carries the very same key, so a later sync can recognise the sale the
    // server already has instead of duplicating it.
    //
    // The key is bound to the sale's contents: once the cashier rings up
    // something different, reusing it would make the server replay the previous
    // order and silently drop this one.
    const fingerprint = saleFingerprint(payload);
    if (pendingServerKey.current?.fingerprint !== fingerprint) {
      pendingServerKey.current = { key: createClientUuid(), fingerprint };
      // A different sale needs its own local identity too, or recordOfflineSale
      // would return the earlier order instead of writing this one.
      pendingOfflineIdentity.current = null;
    }
    const idempotencyKey = pendingServerKey.current.key;

    try {
      // Re-evaluate the authoritative mode at confirmation time: live refs and a
      // fresh IndexedDB count, never a value captured at render.
      const unsyncedOfflineOrderCount = await getUnsyncedOfflineOrderCount();
      const { isBackendOnline } = getSnapshot();
      // Anything the server has not accepted still owns local stock, so a sale
      // that failed to sync keeps the next one local too.
      const useLocalCheckout = !isBackendOnline || unsyncedOfflineOrderCount > 0;
      if (!useLocalCheckout) {
        const response = await createOrder(payload, idempotencyKey);
        pendingServerKey.current = null;
        setState({ pending: false, error: '', response, offlineOrder: null });
        return { mode: 'online', response };
      }

      if (!localDetails) throw new Error('ไม่สามารถบันทึกออเดอร์ในเครื่องได้');
      pendingOfflineIdentity.current ||= createOfflineOrderIdentity();
      const order = await recordOfflineSale({
        identity: pendingOfflineIdentity.current,
        order: payload,
        idempotencyKey,
        ...localDetails,
      });
      pendingOfflineIdentity.current = null;
      pendingServerKey.current = null;
      setState({ pending: false, error: '', response: null, offlineOrder: order });
      return { mode: 'offline', order };
    } catch (error) {
      setState({
        pending: false,
        error: error instanceof Error ? error.message : 'บันทึกออเดอร์ไม่สำเร็จ',
        response: null,
        offlineOrder: null,
      });
      return null;
    } finally {
      locked.current = false;
    }
  }, [getSnapshot]);

  const clearFeedback = useCallback(() => setState((current) => ({ ...current, error: '', response: null, offlineOrder: null })), []);
  const isLocked = useCallback(() => locked.current, []);

  return { ...state, submit, clearFeedback, isLocked };
}
