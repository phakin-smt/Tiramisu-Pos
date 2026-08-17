import { useRef } from 'react';
import { Outlet } from 'react-router-dom';

import { useAuth } from '../features/auth/AuthContext';
import { MobileNavigation } from './MobileNavigation';
import { SidebarNavigation } from './SidebarNavigation';
import { useTabletSwipeNavigation } from './useTabletSwipeNavigation';

function Brand() {
  return (
    <div className="shell-brand">
      <div className="brand-mark" aria-hidden="true">BB</div>
      <div>
        <div className="brand-title-row">
          <strong>Bellies Buddy</strong>
          <span className="version-label">v1.1.0</span>
        </div>
        <span className="brand-subtitle">ระบบขายของหวาน</span>
      </div>
    </div>
  );
}

export function AppShell() {
  const { logout, submitting } = useAuth();
  const mainContent = useRef<HTMLElement>(null);
  useTabletSwipeNavigation(mainContent);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <SidebarNavigation />
        <div className="sidebar-status">
          <span><i aria-hidden="true" /> ออนไลน์</span>
          <button type="button" onClick={logout} disabled={submitting}>
            ออกจากระบบ
          </button>
        </div>
      </aside>

      <header className="mobile-header">
        <Brand />
        <button type="button" onClick={logout} disabled={submitting} aria-label="ออกจากระบบ">
          ออก
        </button>
      </header>

      <main ref={mainContent} className="main-content">
        <Outlet />
      </main>
      <MobileNavigation />
    </div>
  );
}
