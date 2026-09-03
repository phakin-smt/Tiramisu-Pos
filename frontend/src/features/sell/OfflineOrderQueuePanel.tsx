import { useCallback, useEffect, useRef, useState } from 'react';

import { formatCurrency } from '../../domain/format';
import { formatThaiDateTime } from '../../domain/date';
import type { OfflineOrder } from '../../offline/database';
import { getUnsyncedOfflineOrders, retryFailedOfflineOrder } from '../../offline/offlineOrders';

export const OFFLINE_QUEUE_HEADING = 'ออเดอร์ที่ยังไม่ได้ Sync';
export const OFFLINE_QUEUE_RETRY_LABEL = 'ลองอีกครั้ง';

interface OfflineOrderQueuePanelProps {
  storeId: number | null;
  /** Bumped whenever a sync settles, so the list reflects the latest outcome. */
  revision: number;
  syncing: boolean;
  canRetry: boolean;
  onRetry(localOrderId: string): Promise<void>;
}

const paymentLabels: Record<OfflineOrder['paymentMethod'], string> = {
  cash: 'เงินสด',
  transfer: 'PromptPay',
};

export function OfflineOrderQueuePanel({ storeId, revision, syncing, canRetry, onRetry }: OfflineOrderQueuePanelProps) {
  const [orders, setOrders] = useState<OfflineOrder[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      setOrders(storeId === null ? [] : await getUnsyncedOfflineOrders(storeId));
    } catch {
      setOrders([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load, revision]);

  if (!orders.length) return null;

  const pending = orders.filter((order) => order.syncStatus === 'pending').length;
  const failed = orders.length - pending;

  const retry = async (localOrderId: string) => {
    if (inFlight.current.has(localOrderId)) return;
    inFlight.current.add(localOrderId);
    setRetrying(localOrderId);
    try {
      // Requeues the very same order; the sync path reuses its stored key.
      await retryFailedOfflineOrder(localOrderId);
      await onRetry(localOrderId);
      await load();
    } finally {
      inFlight.current.delete(localOrderId);
      setRetrying(null);
    }
  };

  return (
    <section className="surface offline-queue" aria-labelledby="offline-queue-title">
      <div className="section-heading">
        <div>
          <h2 id="offline-queue-title">{OFFLINE_QUEUE_HEADING}</h2>
          <span>
            {`รอ Sync ${pending} รายการ`}
            {failed > 0 && ` · Sync ไม่สำเร็จ ${failed} รายการ`}
          </span>
        </div>
      </div>
      <ul className="offline-queue-list">
        {orders.map((order) => {
          const busy = retrying === order.localOrderId || syncing;
          return (
            <li key={order.localOrderId} className={`offline-queue-item${order.syncStatus === 'failed' ? ' is-failed' : ''}`}>
              <div className="offline-queue-identity">
                <strong>{order.localOrderNumber}</strong>
                <span>{formatThaiDateTime(order.createdAt)}</span>
              </div>
              <div className="offline-queue-figures">
                <strong>{formatCurrency(order.total)}</strong>
                <span>{paymentLabels[order.paymentMethod]}</span>
              </div>
              <div className="offline-queue-state">
                {order.syncStatus === 'failed'
                  ? <span className="offline-queue-error" role="alert">{order.syncError || 'Sync ไม่สำเร็จ'}</span>
                  : <span className="offline-queue-waiting">{syncing ? 'กำลัง Sync' : 'รอ Sync'}</span>}
                {order.stockReview && <span className="offline-queue-review">ต้องตรวจสอบสต็อก</span>}
              </div>
              {order.syncStatus === 'failed' && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !canRetry}
                  onClick={() => { void retry(order.localOrderId); }}
                >
                  {busy ? 'กำลัง Sync...' : OFFLINE_QUEUE_RETRY_LABEL}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
