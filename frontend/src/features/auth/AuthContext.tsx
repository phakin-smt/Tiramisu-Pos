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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isOnline } = useConnectivity();
  const [state, setState] = useState<AuthState>({ phase: 'checking', message: '' });
  const [submitting, setSubmitting] = useState(false);

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
      .then((status) => {
        if (!active) return;
        if (!status.configured) {
          setState({ phase: 'unconfigured', message: 'PIN authentication is not configured.' });
        } else if (status.authenticated) {
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
  }, [isOnline]);

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
      await loginWithPin(pin);
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
  }, []);

  const logout = useCallback(async () => {
    setSubmitting(true);
    try {
      await logoutSession();
    } catch {
      // Match the legacy UI: local access is removed even if logout cannot reach the server.
    } finally {
      setState({ phase: 'unauthenticated', message: 'You have been logged out.' });
      setSubmitting(false);
    }
  }, []);

  const value = useMemo(
    () => ({ ...state, submitting, login, logout }),
    [state, submitting, login, logout],
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

export function AuthGate({ children }: { children: ReactNode }) {
  const { phase } = useAuth();

  if (phase === 'checking') {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        Checking session...
      </div>
    );
  }

  if (phase !== 'authenticated' && phase !== 'expired' && phase !== 'offline') return <LoginForm />;
  return <>
    <div hidden={phase === 'expired'} inert={phase === 'expired'}>{children}</div>
    {phase === 'expired' && <LoginForm />}
  </>;
}
