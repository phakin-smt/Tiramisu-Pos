import { useCallback, useRef, useState } from 'react';

import { createOrder } from '../../api/checkout';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import type { CreateOrderRequest, CreateOrderResponse } from '../../types/checkout';

export const OFFLINE_CHECKOUT_MESSAGE = 'การบันทึกการขายแบบออฟไลน์จะเปิดใช้งานในขั้นตอนถัดไป';

interface CheckoutState {
  pending: boolean;
  error: string;
  response: CreateOrderResponse | null;
}

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random()}`;
}

export function useCheckout() {
  const { isOnline } = useConnectivity();
  const locked = useRef(false);
  const pendingKey = useRef<string | null>(null);
  const [state, setState] = useState<CheckoutState>({ pending: false, error: '', response: null });

  const submit = useCallback(async (payload: CreateOrderRequest): Promise<CreateOrderResponse | null> => {
    if (!isOnline) {
      setState({ pending: false, error: OFFLINE_CHECKOUT_MESSAGE, response: null });
      return null;
    }
    if (locked.current) return null;
    locked.current = true;
    pendingKey.current ||= createIdempotencyKey();
    const key = pendingKey.current;
    setState({ pending: true, error: '', response: null });

    try {
      const response = await createOrder(payload, key);
      pendingKey.current = null;
      setState({ pending: false, error: '', response });
      return response;
    } catch (error) {
      setState({
        pending: false,
        error: error instanceof Error ? error.message : 'บันทึกออเดอร์ไม่สำเร็จ',
        response: null,
      });
      return null;
    } finally {
      locked.current = false;
    }
  }, [isOnline]);

  const clearFeedback = useCallback(() => setState((current) => ({ ...current, error: '', response: null })), []);
  const isLocked = useCallback(() => locked.current, []);

  return { ...state, submit, clearFeedback, isLocked };
}
