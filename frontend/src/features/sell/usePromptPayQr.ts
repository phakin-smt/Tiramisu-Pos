import { useEffect, useMemo, useState } from 'react';

import { getPaymentQr } from '../../api/checkout';

interface PromptPayQrState {
  amount: number | null;
  url: string;
  loading: boolean;
  error: string;
}

const idleState: PromptPayQrState = { amount: null, url: '', loading: false, error: '' };

export function usePromptPayQr(open: boolean, amount: number) {
  const [state, setState] = useState<PromptPayQrState>(idleState);

  useEffect(() => {
    if (!open) {
      setState(idleState);
      return;
    }

    const controller = new AbortController();
    let current = true;
    let objectUrl = '';
    setState({ amount, url: '', loading: true, error: '' });
    getPaymentQr(amount, controller.signal)
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ amount, url: objectUrl, loading: false, error: '' });
      })
      .catch((error: unknown) => {
        if (!current || controller.signal.aborted) return;
        setState({
          amount,
          url: '',
          loading: false,
          error: error instanceof Error ? error.message : 'สร้าง QR ไม่สำเร็จ',
        });
      });

    return () => {
      current = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [amount, open]);

  return useMemo(() => {
    if (!open) return idleState;
    if (state.amount !== amount) return { amount, url: '', loading: true, error: '' };
    return state;
  }, [amount, open, state]);
}
