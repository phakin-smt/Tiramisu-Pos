import { useRef } from 'react';
import { Outlet } from 'react-router-dom';

import { useConnectivity } from '../connectivity/ConnectivityContext';
import { useAuth } from '../features/auth/AuthContext';
import { MobileNavigation } from './MobileNavigation';
import { SidebarNavigation } from './SidebarNavigation';
import { useTabletSwipeNavigation } from './useTabletSwipeNavigation';

function Brand() {
  return (
    <div className="shell-brand">
      <div className="brand-mark" aria-hidden="true">BP</div>
      <div>
        <div className="brand-title-row">
          <strong>Baannoi-POS</strong>
          <span className="version-label">v1.1.0</span>
        </div>
        <span className="brand-subtitle">ระบบขายของหวาน</span>
      </div>
    </div>
  );
}

function ConnectivityStatus({ compact = false }: { compact?: boolean }) {
  const { isOnline } = useConnectivity();
  return (
    <span
      className={`connectivity-status ${isOnline ? 'is-online' : 'is-offline'}${compact ? ' is-compact' : ''}`}
      role="status"
      aria-live="polite"
    >
      <i aria-hidden="true" />
      {isOnline ? 'Online' : 'Offline'}
    </span>
  );
}

export function AppShell() {
  const { logout, submitting } = useAuth();
  const { isOnline } = useConnectivity();
  const mainContent = useRef<HTMLElement>(null);
  useTabletSwipeNavigation(mainContent);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <SidebarNavigation />
        <div className="sidebar-status">
          <ConnectivityStatus />
          <button type="button" onClick={logout} disabled={submitting}>
            ออกจากระบบ
          </button>
        </div>
      </aside>

      <header className="mobile-header">
        <Brand />
        <div className="mobile-header-actions">
          <ConnectivityStatus compact />
          <button type="button" onClick={logout} disabled={submitting} aria-label="ออกจากระบบ">
            ออก
          </button>
        </div>
      </header>

      <main ref={mainContent} className="main-content">
        {!isOnline && (
          <p className="offline-foundation-message" role="note">
            โหมดออฟไลน์กำลังเตรียมใช้งาน ตอนนี้เปิดแอปได้ แต่ยังไม่สามารถบันทึกการขายแบบออฟไลน์ได้
          </p>
        )}
        <Outlet />
      </main>
      <MobileNavigation />
    </div>
  );
}
