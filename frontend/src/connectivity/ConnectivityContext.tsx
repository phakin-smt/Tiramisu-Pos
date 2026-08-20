import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface ConnectivityContextValue {
  isOnline: boolean;
}

const ConnectivityContext = createContext<ConnectivityContextValue>({ isOnline: true });

function getBrowserConnectivity() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(getBrowserConnectivity);

  useEffect(() => {
    const updateConnectivity = () => setIsOnline(getBrowserConnectivity());

    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    return () => {
      window.removeEventListener('online', updateConnectivity);
      window.removeEventListener('offline', updateConnectivity);
    };
  }, []);

  const value = useMemo(() => ({ isOnline }), [isOnline]);
  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity() {
  return useContext(ConnectivityContext);
}
