import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

import { getPaymentQr } from '../../api/checkout';
import {
  OFFLINE_PROMPTPAY_CONFIG_GUIDANCE,
  OFFLINE_PROMPTPAY_CONFIG_MISSING_MESSAGE,
  readOfflinePaymentConfig,
} from '../../offline/paymentConfig';
import { generatePromptPayPayload } from '../../offline/promptPayPayload';

interface PromptPayQrState {
  amount: number | null;
  mode: 'cloud' | 'local';
  url: string;
  loading: boolean;
  error: string;
  guidance: string;
}

const idleState: PromptPayQrState = {
  amount: null,
  mode: 'cloud',
  url: '',
  loading: false,
  error: '',
  guidance: '',
};

export function usePromptPayQr(open: boolean, amount: number, localMode: boolean) {
  const [state, setState] = useState<PromptPayQrState>(idleState);

  useEffect(() => {
    if (!open) {
      setState(idleState);
      return;
    }

    const mode = localMode ? 'local' : 'cloud';
    const controller = new AbortController();
    let current = true;
    let objectUrl = '';
    setState({ amount, mode, url: '', loading: true, error: '', guidance: '' });

    const request = localMode
      ? readOfflinePaymentConfig().then(async (config) => {
          if (!config) {
            throw Object.assign(new Error(OFFLINE_PROMPTPAY_CONFIG_MISSING_MESSAGE), {
              guidance: OFFLINE_PROMPTPAY_CONFIG_GUIDANCE,
            });
          }
          const payload = generatePromptPayPayload(config.merchantAccountInfo, amount);
          const svg = await QRCode.toString(payload, {
            type: 'svg',
            errorCorrectionLevel: 'M',
            margin: 4,
            width: 360,
            color: { dark: '#000000', light: '#ffffff' },
          });
          objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          return objectUrl;
        })
      : getPaymentQr(amount, controller.signal).then((blob) => {
          objectUrl = URL.createObjectURL(blob);
          return objectUrl;
        });

    request
      .then((url) => {
        if (current) setState({ amount, mode, url, loading: false, error: '', guidance: '' });
      })
      .catch((error: unknown) => {
        if (!current || controller.signal.aborted) return;
        const guidance = error && typeof error === 'object' && 'guidance' in error
          ? String(error.guidance)
          : '';
        setState({
          amount,
          mode,
          url: '',
          loading: false,
          error: error instanceof Error ? error.message : 'สร้าง QR ไม่สำเร็จ',
          guidance,
        });
      });

    return () => {
      current = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [amount, localMode, open]);

  return useMemo(() => {
    if (!open) return idleState;
    const mode = localMode ? 'local' : 'cloud';
    if (state.amount !== amount || state.mode !== mode) {
      return { amount, mode, url: '', loading: true, error: '', guidance: '' };
    }
    return state;
  }, [amount, localMode, open, state]);
}
