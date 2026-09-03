import { useRef } from 'react';
import { Outlet } from 'react-router-dom';

import { useConnectivity } from '../connectivity/ConnectivityContext';
import { useAuth } from '../features/auth/AuthContext';
import { isStorageDurable, STORAGE_NOT_PERSISTED_MESSAGE } from '../offline/storagePersistence';
import { isCheckoutActive } from '../pwa/updateGate';
import { useStore } from '../features/stores/StoreContext';
import { MobileNavigation } from './MobileNavigation';
import { SidebarNavigation } from './SidebarNavigation';
import { useTabletSwipeNavigation } from './useTabletSwipeNavigation';

function Brand() {
  const { storeName, storeLogoUrl } = useStore();
  return (
    <div className="shell-brand">
      {/* A shop without a mark of its own keeps the initials rather than
          borrowing another shop's. */}
      {storeLogoUrl
        ? <img className="brand-logo" src={storeLogoUrl} alt="" aria-hidden="true" />
        : <div className="brand-mark" aria-hidden="true">BP</div>}
      <div>
        <div className="brand-title-row">
          <strong>Baannoi-POS</strong>
          <span className="version-label">v1.1.0</span>
        </div>
        {/* Which shop this till is ringing up for, kept in sight rather than
            behind a menu: everything on screen belongs to it. */}
        <span className="brand-subtitle">{storeName || 'ระบบขายของหวาน'}</span>
      </div>
    </div>
  );
}

/**
 * Offered only when there is somewhere else to go, and never mid-sale -- the
 * cart belongs to the store that is open, and switching clears it.
 */
function StoreSwitch({ compact = false }: { compact?: boolean }) {
  const { stores, requestSwitch } = useStore();
  if (stores.length < 2) return null;
  return (
    <button
      type="button"
      className="store-switch"
      disabled={isCheckoutActive()}
      onClick={requestSwitch}
    >
      {compact ? 'ร้าน' : 'เปลี่ยนร้าน'}
    </button>
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
          <StoreSwitch />
          <button type="button" onClick={logout} disabled={submitting} aria-busy={submitting}>
            {submitting ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
          </button>
        </div>
      </aside>

      <header className="mobile-header">
        <Brand />
        <div className="mobile-header-actions">
          <ConnectivityStatus compact />
          <StoreSwitch compact />
          <button type="button" onClick={logout} disabled={submitting} aria-busy={submitting} aria-label="ออกจากระบบ">
            {submitting ? '...' : 'ออก'}
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
