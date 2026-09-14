import { useEffect, useRef, useState } from 'react';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string;
}

const NO_RESET_KEY = Symbol('no-reset-key');

/**
 * Without a `resetKey` every reload clears the data first. With one, a reload
 * under the same key keeps the last data on screen until the new data arrives,
 * so a refresh after an edit updates in place instead of blanking the page.
 * Change the key (a different date, say) to clear stale data from another view.
 */
export function useAbortableQuery<T>(
  request: ((signal: AbortSignal) => Promise<T>) | null,
  dependencies: readonly unknown[],
  resetKey: unknown = NO_RESET_KEY,
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: Boolean(request), error: '' });
  const loadedKey = useRef<unknown>(NO_RESET_KEY);

  useEffect(() => {
    if (!request) {
      loadedKey.current = NO_RESET_KEY;
      setState({ data: null, loading: false, error: '' });
      return;
    }

    const controller = new AbortController();
    let current = true;
    const keepData = resetKey !== NO_RESET_KEY && Object.is(loadedKey.current, resetKey);
    setState((previous) => ({ data: keepData ? previous.data : null, loading: true, error: '' }));
    request(controller.signal)
      .then((data) => {
        if (!current) return;
        loadedKey.current = resetKey;
        setState({ data, loading: false, error: '' });
      })
      .catch((error: unknown) => {
        if (!current || controller.signal.aborted) return;
        loadedKey.current = NO_RESET_KEY;
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูลได้',
        });
      });

    return () => {
      current = false;
      controller.abort();
    };
    // The caller supplies the values that define request identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return state;
}
