import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { navigationItems } from '../components/navigation';
import { AuthGate } from '../features/auth/AuthContext';
import { StoreProvider } from '../features/stores/StoreContext';
import { StoreGate } from '../features/stores/StoreGate';
import { AnalyticsPage } from '../features/analytics/AnalyticsPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { StockPage } from '../features/stock/StockPage';
import { ProductsAdminPage } from '../features/products-admin/ProductsAdminPage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { SellPage } from '../features/sell/SellPage';

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
            <StoreProvider>
              <StoreGate>
                <AppShell />
              </StoreGate>
            </StoreProvider>
          </AuthGate>
        )}
      >
        <Route index element={<Navigate to="/sell" replace />} />
        {navigationItems.filter((item) => !['/sell', '/stock', '/orders', '/reports', '/analytics', '/settings'].includes(item.path)).map((item) => (
          <Route
            key={item.path}
            path={item.path.slice(1)}
            element={<Placeholder title={item.label} />}
          />
        ))}
        <Route path="sell" element={<SellPage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="settings" element={<ProductsAdminPage />} />
        <Route path="*" element={<Navigate to="/sell" replace />} />
      </Route>
    </Routes>
  );
}
