import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { navigationItems } from '../components/navigation';
import { AuthGate } from '../features/auth/AuthContext';

function Placeholder({ title }: { title: string }) {
  return (
    <section className="placeholder-page">
      <PageHeader title={title} />
    </section>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        element={(
          <AuthGate>
            <AppShell />
          </AuthGate>
        )}
      >
        <Route index element={<Navigate to="/sell" replace />} />
        {navigationItems.map((item) => (
          <Route
            key={item.path}
            path={item.path.slice(1)}
            element={<Placeholder title={item.label} />}
          />
        ))}
        <Route path="*" element={<Navigate to="/sell" replace />} />
      </Route>
    </Routes>
  );
}
