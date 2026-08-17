import { useCallback, useRef, useState } from 'react';

interface MutationState {
  pending: boolean;
  error: string;
  success: string;
}

export function useSafeMutation() {
  const locked = useRef(false);
  const [state, setState] = useState<MutationState>({ pending: false, error: '', success: '' });

  const run = useCallback(async <T,>(action: () => Promise<T>, success: string): Promise<T | null> => {
    if (locked.current) return null;
    locked.current = true;
    setState({ pending: true, error: '', success: '' });
    try {
      const result = await action();
      setState({ pending: false, error: '', success });
      return result;
    } catch (error) {
      setState({ pending: false, error: error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ', success: '' });
      return null;
    } finally {
      locked.current = false;
    }
  }, []);

  const clear = useCallback(() => setState({ pending: false, error: '', success: '' }), []);
  return { ...state, run, clear };
}
