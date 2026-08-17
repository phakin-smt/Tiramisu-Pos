import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';

const routes = [
  ['sell', 'ขาย'],
  ['stock', 'สต็อก'],
  ['orders', 'ออเดอร์'],
  ['reports', 'รายงาน'],
  ['analytics', 'วิเคราะห์'],
  ['settings', 'ตั้งค่า'],
] as const;

function AppLayout() {
  return (
    <div className="app-shell">
      <header>
        <strong>Bellies Buddy POS</strong>
        <nav aria-label="หน้าหลัก">
          {routes.map(([path, label]) => (
            <NavLink key={path} to={`/${path}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return <h1>{title}</h1>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/sell" replace />} />
        {routes.map(([path, label]) => (
          <Route key={path} path={path} element={<Placeholder title={label} />} />
        ))}
      </Route>
    </Routes>
  );
}
