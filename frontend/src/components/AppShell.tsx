import { useRef } from 'react';
import { Outlet } from 'react-router-dom';

import { useConnectivity } from '../connectivity/ConnectivityContext';
import { useAuth } from '../features/auth/AuthContext';
import { isStorageDurable, STORAGE_NOT_PERSISTED_MESSAGE } from '../offline/storagePersistence';
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
  const { logout, submitting, storagePersistence } = useAuth();
  const { isOnline, isBackendReachable } = useConnectivity();
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
            โหมดออฟไลน์ · ขายเงินสดและ PromptPay ได้บนอุปกรณ์ที่ได้รับอนุญาต
          </p>
        )}
        {isOnline && !isBackendReachable && (
          <p className="offline-foundation-message" role="status" aria-live="polite">
            ต่ออินเทอร์เน็ตได้ แต่ติดต่อเซิร์ฟเวอร์ไม่ได้ · การขายจะบันทึกในเครื่อง
          </p>
        )}
        {storagePersistence !== 'unknown' && !isStorageDurable(storagePersistence) && (
          <p className="offline-foundation-message" role="status" aria-live="polite">
            {STORAGE_NOT_PERSISTED_MESSAGE}
          </p>
        )}
        <Outlet />
      </main>
      <MobileNavigation />
    </div>
  );
}
