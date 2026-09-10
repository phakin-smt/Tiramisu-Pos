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
  /**
   * True when the code on screen is the shop's own picture, which cannot carry
   * a total. The modal has to show the amount itself and the customer types it,
   * so this has to reach the UI rather than being handled here.
   */
  amountInQr: boolean;
  loading: boolean;
  error: string;
  guidance: string;
}

const idleState: PromptPayQrState = {
  amount: null,
  mode: 'cloud',
  url: '',
  amountInQr: true,
  loading: false,
  error: '',
  guidance: '',
};

export function usePromptPayQr(open: boolean, amount: number, localMode: boolean, storeId?: number) {
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
    setState({ amount, mode, url: '', amountInQr: true, loading: true, error: '', guidance: '' });

    const fromLocal = async () => {
      const config = await readOfflinePaymentConfig(storeId);
      if (!config) {
        throw Object.assign(new Error(OFFLINE_PROMPTPAY_CONFIG_MISSING_MESSAGE), {
          guidance: OFFLINE_PROMPTPAY_CONFIG_GUIDANCE,
        });
      }
      if (config.mode === 'image') {
        if (!config.imageData) {
          throw Object.assign(new Error(OFFLINE_PROMPTPAY_CONFIG_MISSING_MESSAGE), {
            guidance: OFFLINE_PROMPTPAY_CONFIG_GUIDANCE,
          });
        }
        objectUrl = URL.createObjectURL(new Blob([config.imageData], { type: config.imageType || 'image/png' }));
        return { url: objectUrl, amountInQr: false };
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
      return { url: objectUrl, amountInQr: true };
    };

    const fromCloud = async () => {
      // One request: the server hands back whichever QR this shop is paid
      // through, and says in a header whether the amount is inside it.
      const { blob, amountInQr } = await getPaymentQr(amount, controller.signal);
      objectUrl = URL.createObjectURL(blob);
      return { url: objectUrl, amountInQr };
    };

    const request = localMode ? fromLocal() : fromCloud();

    request
      .then(({ url, amountInQr }) => {
        if (current) setState({ amount, mode, url, amountInQr, loading: false, error: '', guidance: '' });
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
          amountInQr: true,
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
  }, [amount, localMode, open, storeId]);

  return useMemo(() => {
    if (!open) return idleState;
    const mode = localMode ? 'local' : 'cloud';
    if (state.amount !== amount || state.mode !== mode) {
      return { amount, mode, url: '', amountInQr: true, loading: true, error: '', guidance: '' };
    }
    return state;
  }, [amount, localMode, open, state]);
}
