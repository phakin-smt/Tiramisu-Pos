import { BrowserRouter } from 'react-router-dom';

import { ConnectivityProvider } from '../connectivity/ConnectivityContext';
import { AuthProvider } from '../features/auth/AuthContext';
import { AppRoutes } from './router';

export function App() {
  return (
    <ConnectivityProvider>
      <AuthProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ConnectivityProvider>
  );
}
