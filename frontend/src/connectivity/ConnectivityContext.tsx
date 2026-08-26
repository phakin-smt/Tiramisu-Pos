import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { probeBackendReachable } from '../api/health';
import { subscribeToBackendReachability } from '../api/client';

/** Only used to recover from an unreachable backend, never while things are healthy. */
export const BACKEND_RECOVERY_PROBE_INTERVAL_MS = 30_000;

export interface ConnectivitySnapshot {
  /** The browser reports a network interface. Says nothing about the server. */
  isOnline: boolean;
  /** The Baannoi POS backend actually answered the last time we heard from it. */
  isBackendReachable: boolean;
  /** Both of the above: the authoritative signal for choosing Cloud vs Local. */
  isBackendOnline: boolean;
}

interface ConnectivityContextValue extends ConnectivitySnapshot {
  /**
   * Reads connectivity straight from refs rather than render state, so a
   * confirmation handler can never decide Cloud vs Local from a stale render.
   */
  getSnapshot(): ConnectivitySnapshot;
  probeBackend(): Promise<boolean>;
}

function getBrowserConnectivity() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

const defaultSnapshot: ConnectivitySnapshot = {
  isOnline: true,
  isBackendReachable: true,
  isBackendOnline: true,
};

// Outside a provider the browser flag is all we have, but it is still read live
// rather than frozen, so a provider-less consumer keeps its old behaviour.
const ConnectivityContext = createContext<ConnectivityContextValue>({
  ...defaultSnapshot,
  getSnapshot: () => {
    const browserOnline = getBrowserConnectivity();
    return { isOnline: browserOnline, isBackendReachable: true, isBackendOnline: browserOnline };
  },
  probeBackend: async () => true,
});

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(getBrowserConnectivity);
  // Optimistic: assume the backend is fine until something tells us otherwise,
  // so a fresh session never starts by declaring the server down.
  const [isBackendReachable, setIsBackendReachable] = useState(true);
  const reachableRef = useRef(true);

  const applyReachability = useCallback((reachable: boolean) => {
    reachableRef.current = reachable;
    setIsBackendReachable(reachable);
  }, []);

  const probeBackend = useCallback(async () => {
    if (!getBrowserConnectivity()) return false;
    const reachable = await probeBackendReachable();
    applyReachability(reachable);
    return reachable;
  }, [applyReachability]);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(getBrowserConnectivity());
      // Coming back from a dead interface says nothing about the server yet.
      void probeBackend();
    };
    const goOffline = () => setIsOnline(getBrowserConnectivity());

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [probeBackend]);

  // Ordinary API traffic is the cheapest reachability signal there is, so a
  // healthy app never spends a request on probing.
  useEffect(() => subscribeToBackendReachability(applyReachability), [applyReachability]);

  useEffect(() => {
    if (isBackendReachable || !isOnline) return;
    const timer = window.setInterval(() => { void probeBackend(); }, BACKEND_RECOVERY_PROBE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isBackendReachable, isOnline, probeBackend]);

  const getSnapshot = useCallback((): ConnectivitySnapshot => {
    const browserOnline = getBrowserConnectivity();
    return {
      isOnline: browserOnline,
      isBackendReachable: reachableRef.current,
      isBackendOnline: browserOnline && reachableRef.current,
    };
  }, []);

  const value = useMemo(() => ({
    isOnline,
    isBackendReachable,
    isBackendOnline: isOnline && isBackendReachable,
    getSnapshot,
    probeBackend,
  }), [getSnapshot, isBackendReachable, isOnline, probeBackend]);

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity() {
  return useContext(ConnectivityContext);
}
