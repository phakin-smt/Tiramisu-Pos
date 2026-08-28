import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { getAuthStatus, loginWithPin, logoutSession } from '../../api/auth';
import { subscribeToUnauthorized } from '../../api/client';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { useOfflineAuthorization } from '../../offline/useOfflineAuthorization';
import { refreshOfflineAuthorization, revokeOfflineAuthorization } from '../../offline/offlineAuthorization';
import { clearOfflinePaymentConfig, provisionOfflinePaymentConfig } from '../../offline/paymentConfig';
import {
  requestPersistentStorage,
  type StoragePersistenceStatus,
} from '../../offline/storagePersistence';

type AuthPhase =
  | 'checking'
  | 'authenticated'
  | 'offline'
  | 'unauthenticated'
  | 'unconfigured'
  | 'expired';

interface AuthState {
  phase: AuthPhase;
  message: string;
}

interface AuthContextValue extends AuthState {
  login(pin: string): Promise<boolean>;
  logout(): Promise<void>;
  submitting: boolean;
  /** Whether the browser agreed to keep offline data out of its eviction pool. */
  storagePersistence: StoragePersistenceStatus;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isOnline } = useConnectivity();
  const [state, setState] = useState<AuthState>({ phase: 'checking', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [storagePersistence, setStoragePersistence] = useState<StoragePersistenceStatus>('unknown');

  /**
   * Everything a trusted device needs for offline selling, provisioned on the
   * one occasion we know we are both online and authenticated. Settled, not
   * awaited for success: none of these may block a cashier from logging in.
   */
  const provisionOfflineDevice = useCallback(async () => {
    const [, , persistence] = await Promise.allSettled([
      refreshOfflineAuthorization(),
      provisionOfflinePaymentConfig(),
      requestPersistentStorage(),
    ]);
    setStoragePersistence(persistence.status === 'fulfilled' ? persistence.value : 'unsupported');
  }, []);

  useEffect(() => {
    let active = true;

    if (!isOnline) {
      setState({ phase: 'offline', message: '' });
      return () => {
        active = false;
      };
    }

    setState((current) => (
      current.phase === 'offline' ? { phase: 'checking', message: '' } : current
    ));
    getAuthStatus()
      .then(async (status) => {
        if (!active) return;
        if (!status.configured) {
          setState({ phase: 'unconfigured', message: 'PIN authentication is not configured.' });
        } else if (status.authenticated) {
          await provisionOfflineDevice();
          if (!active) return;
          setState({ phase: 'authenticated', message: '' });
        } else {
          setState({ phase: 'unauthenticated', message: '' });
        }
      })
      .catch(() => {
        if (active) {
          setState({ phase: 'unauthenticated', message: 'Unable to connect to the server.' });
        }
      });

    return () => {
      active = false;
    };
  }, [isOnline, provisionOfflineDevice]);

  useEffect(
    () =>
      subscribeToUnauthorized(() => {
        setState({ phase: 'expired', message: 'Session expired. Please log in again.' });
      }),
    [],
  );

  const login = useCallback(async (pin: string) => {
    setSubmitting(true);
    try {
      const status = await loginWithPin(pin);
      if (!status.authenticated) throw new Error('Login failed');
      await provisionOfflineDevice();
      setState({ phase: 'authenticated', message: '' });
      return true;
    } catch (error) {
      setState((current) => ({
        phase: current.phase === 'expired' ? 'expired' : 'unauthenticated',
        message: error instanceof Error ? error.message : 'Login failed',
      }));
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [provisionOfflineDevice]);

  const logout = useCallback(async () => {
    setSubmitting(true);
    try {
      await logoutSession();
    } catch {
      // Match the legacy UI: local access is removed even if logout cannot reach the server.
    } finally {
      // Revoked even when the server could not be reached, so signing out always
      // ends this device's ability to sell offline. Unsynced orders are kept —
      // they are recorded revenue, not credentials.
      await Promise.allSettled([revokeOfflineAuthorization(), clearOfflinePaymentConfig()]);
      setStoragePersistence('unknown');
      setState({ phase: 'unauthenticated', message: 'You have been logged out.' });
      setSubmitting(false);
    }
  }, []);

  const value = useMemo(
    () => ({ ...state, submitting, login, logout, storagePersistence }),
    [state, submitting, login, logout, storagePersistence],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}

export function LoginForm() {
  const { login, message, submitting, phase } = useAuth();
  const [pin, setPin] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await login(pin)) setPin('');
  }

  return (
    <div className="login-screen">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="brand-mark" aria-hidden="true">BP</div>
        <h1>Baannoi-POS</h1>
        <span className="version-label">v1.1.0</span>
        <p>Enter your PIN to continue</p>
        <label htmlFor="login-pin">PIN</label>
        <input
          id="login-pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          disabled={submitting || phase === 'unconfigured'}
          required
          autoFocus
        />
        <div className="auth-message" role="alert" aria-live="assertive">
          {message}
        </div>
        <button type="submit" disabled={submitting || phase === 'unconfigured'}>
          {submitting ? 'Logging in...' : 'Log in'}
        </button>
      </form>
    </div>
  );
}

export const OFFLINE_WORKSPACE_LOCKED_MESSAGE = 'อุปกรณ์นี้ยังไม่ได้รับอนุญาตให้ใช้งานออฟไลน์';
export const OFFLINE_WORKSPACE_LOCKED_GUIDANCE = 'กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเข้าสู่ระบบด้วย PIN อีกครั้ง';

/**
 * Shown offline when this device holds no trusted-device authorization — after a
 * logout, after expiry, or on a device that never provisioned.
 *
 * This is an authorization check on a local marker, not authentication: the PIN
 * itself can only be verified by the server. See the offline PIN limitation note.
 */
function OfflineWorkspaceLocked() {
  return (
    <div className="login-screen">
      <div className="login-panel" role="alert">
        <div className="brand-mark" aria-hidden="true">BP</div>
        <h1>Baannoi-POS</h1>
        <p>{OFFLINE_WORKSPACE_LOCKED_MESSAGE}</p>
        <div className="auth-message">{OFFLINE_WORKSPACE_LOCKED_GUIDANCE}</div>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { phase } = useAuth();
  const offlineAuthorization = useOfflineAuthorization();

  if (phase === 'checking') {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        Checking session...
      </div>
    );
  }

  if (phase === 'offline') {
    if (offlineAuthorization.checking) {
      return (
        <div className="auth-loading" role="status" aria-live="polite">
          Checking session...
        </div>
      );
    }
    // Logging out revokes the marker, so an offline device cannot simply be
    // reopened into the workspace afterwards.
    if (!offlineAuthorization.authorized) return <OfflineWorkspaceLocked />;
    return <>{children}</>;
  }

  if (phase !== 'authenticated' && phase !== 'expired') return <LoginForm />;
  return <>
    <div hidden={phase === 'expired'} inert={phase === 'expired'}>{children}</div>
    {phase === 'expired' && <LoginForm />}
  </>;
}
