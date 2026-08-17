import { useEffect, useState } from 'react';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string;
}

export function useAbortableQuery<T>(
  request: ((signal: AbortSignal) => Promise<T>) | null,
  dependencies: readonly unknown[],
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: Boolean(request), error: '' });

  useEffect(() => {
    if (!request) {
      setState({ data: null, loading: false, error: '' });
      return;
    }

    const controller = new AbortController();
    let current = true;
    setState({ data: null, loading: true, error: '' });
    request(controller.signal)
      .then((data) => {
        if (current) setState({ data, loading: false, error: '' });
      })
      .catch((error: unknown) => {
        if (!current || controller.signal.aborted) return;
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
