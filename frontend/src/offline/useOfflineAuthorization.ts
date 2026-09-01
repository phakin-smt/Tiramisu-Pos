import { useCallback, useEffect, useState } from 'react';

import { useConnectivity } from '../connectivity/ConnectivityContext';
import { readOfflineAuthorization } from './offlineAuthorization';

interface AuthorizationState {
  authorized: boolean;
  checking: boolean;
}

export function useOfflineAuthorization() {
  const { isOnline } = useConnectivity();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<AuthorizationState>({ authorized: false, checking: !isOnline });

  useEffect(() => {
    let active = true;
    if (isOnline) {
      setState({ authorized: false, checking: false });
      return () => { active = false; };
    }
    setState((current) => ({ ...current, checking: true }));
    readOfflineAuthorization()
      .then((authorization) => {
        if (active) setState({ authorized: authorization.authorized, checking: false });
      })
      .catch(() => {
        if (active) setState({ authorized: false, checking: false });
      });
    return () => { active = false; };
  }, [isOnline, revision]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  return { ...state, refresh };
}
