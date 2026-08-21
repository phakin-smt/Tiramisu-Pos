import { useCallback, useRef, useState } from 'react';

import { createOrder } from '../../api/checkout';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import type { OfflineOrder } from '../../offline/database';
import {
  createClientUuid,
  createOfflineOrderIdentity,
  getPendingOfflineOrderCount,
  OFFLINE_PROMPTPAY_MESSAGE,
  recordOfflineCashSale,
  type OfflineCashDetails,
} from '../../offline/offlineOrders';
import type { CreateOrderRequest, CreateOrderResponse } from '../../types/checkout';

interface CheckoutState {
  pending: boolean;
  error: string;
  response: CreateOrderResponse | null;
  offlineOrder: OfflineOrder | null;
}

export type CheckoutResult =
  | { mode: 'online'; response: CreateOrderResponse }
  | { mode: 'offline'; order: OfflineOrder };

export function useCheckout() {
  const { isOnline } = useConnectivity();
  const locked = useRef(false);
  const pendingServerKey = useRef<string | null>(null);
  const pendingOfflineIdentity = useRef<ReturnType<typeof createOfflineOrderIdentity> | null>(null);
  const [state, setState] = useState<CheckoutState>({ pending: false, error: '', response: null, offlineOrder: null });

  const submit = useCallback(async (
    payload: CreateOrderRequest,
    cashDetails?: OfflineCashDetails,
  ): Promise<CheckoutResult | null> => {
    if (locked.current) return null;
    locked.current = true;
    setState({ pending: true, error: '', response: null, offlineOrder: null });

    try {
      const pendingOfflineOrderCount = await getPendingOfflineOrderCount();
      const useLocalCheckout = !isOnline || !navigator.onLine || pendingOfflineOrderCount > 0;
      if (!useLocalCheckout) {
        pendingServerKey.current ||= createClientUuid();
        const response = await createOrder(payload, pendingServerKey.current);
        pendingServerKey.current = null;
        setState({ pending: false, error: '', response, offlineOrder: null });
        return { mode: 'online', response };
      }

      if (payload.paymentMethod !== 'cash' || !cashDetails) throw new Error(OFFLINE_PROMPTPAY_MESSAGE);
      pendingOfflineIdentity.current ||= createOfflineOrderIdentity();
      const order = await recordOfflineCashSale({ identity: pendingOfflineIdentity.current, order: payload, ...cashDetails });
      pendingOfflineIdentity.current = null;
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
  }, [isOnline]);

  const clearFeedback = useCallback(() => setState((current) => ({ ...current, error: '', response: null, offlineOrder: null })), []);
  const isLocked = useCallback(() => locked.current, []);

  return { ...state, submit, clearFeedback, isLocked };
}
