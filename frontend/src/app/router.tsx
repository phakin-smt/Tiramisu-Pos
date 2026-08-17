import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { navigationItems } from '../components/navigation';
import { AuthGate } from '../features/auth/AuthContext';
import { AnalyticsPage } from '../features/analytics/AnalyticsPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { StockPage } from '../features/stock/StockPage';

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
        {navigationItems.filter((item) => !['/stock', '/reports', '/analytics'].includes(item.path)).map((item) => (
          <Route
            key={item.path}
            path={item.path.slice(1)}
            element={<Placeholder title={item.label} />}
          />
        ))}
        <Route path="stock" element={<StockPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="*" element={<Navigate to="/sell" replace />} />
      </Route>
    </Routes>
  );
}
