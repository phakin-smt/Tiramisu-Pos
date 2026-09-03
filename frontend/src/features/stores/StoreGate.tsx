import { useState, type ReactNode } from 'react';

import { useStore } from './StoreContext';

export const STORE_PICKER_TITLE = 'เลือกร้านที่จะขาย';
export const STORE_OFFLINE_UNKNOWN = 'อุปกรณ์นี้ยังไม่เคยเลือกร้าน';
export const STORE_OFFLINE_GUIDANCE = 'กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเลือกร้านอย่างน้อย 1 ครั้ง';

function StorePicker() {
  const { stores, storeId, choose, cancelSwitch, loading, error, switching } = useStore();
  // Which one was clicked, so the wait is shown on that button rather than
  // leaving every option looking equally inert.
  const [choosing, setChoosing] = useState<number | null>(null);

  async function pick(id: number) {
    setChoosing(id);
    try {
      await choose(id);
    } finally {
      setChoosing(null);
    }
  }

  if (!stores.length) {
    return (
      <div className="login-screen">
        <div className="login-panel" role="alert">
          <div className="brand-mark" aria-hidden="true">BP</div>
          <h1>Baannoi-POS</h1>
          <p>{STORE_OFFLINE_UNKNOWN}</p>
          <div className="auth-message">{error || STORE_OFFLINE_GUIDANCE}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-panel store-picker">
        <div className="brand-mark" aria-hidden="true">BP</div>
        <h1>{STORE_PICKER_TITLE}</h1>
        <p>ทุกอย่างหลังจากนี้ — เมนู สต็อก ยอดขาย — เป็นของร้านที่เลือก</p>
        <ul className="store-option-list">
          {stores.map((store) => (
            <li key={store.id}>
              <button
                type="button"
                className={`store-option${store.id === storeId ? ' is-current' : ''}`}
                disabled={loading}
                aria-busy={choosing === store.id}
                onClick={() => { void pick(store.id); }}
              >
                <strong>{store.name}</strong>
                {choosing === store.id
                  ? <span>กำลังเปลี่ยน...</span>
                  : store.id === storeId && <span>กำลังใช้อยู่</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="auth-message" role="alert" aria-live="assertive">{error}</div>
        {switching && storeId !== null && (
          <button type="button" className="secondary-button" disabled={loading} onClick={cancelSwitch}>
            ยกเลิก
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Holds the workspace closed until it is clear which store this session sells
 * for, and reopens it when the cashier asks to change.
 *
 * Children are keyed on the store so switching remounts the whole workspace.
 * A cart, a catalogue or a day's report carried across that boundary would be
 * one shop's numbers shown under another shop's name.
 */
export function StoreGate({ children }: { children: ReactNode }) {
  const { loading, storeId, stores, switching } = useStore();

  // Only before the list of stores has arrived. Once it has, the picker stays on
  // screen through the choosing itself, so the press lands somewhere visible
  // instead of replacing the whole list with a loading message.
  if (loading && storeId === null && stores.length === 0) {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        กำลังโหลดข้อมูลร้าน...
      </div>
    );
  }
  if (storeId === null || switching) return <StorePicker />;
  return <div key={storeId ?? 'none'} className="store-scope">{children}</div>;
}
