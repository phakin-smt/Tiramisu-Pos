import { useCallback, useEffect, useRef, useState } from 'react';

import { reconcileStock } from '../../api/stock';
import { createClientUuid } from '../../offline/offlineOrders';
import {
  getPendingStockReviews,
  resolveStockReview,
  STOCK_REVIEW_HEADING,
  STOCK_REVIEW_MESSAGE,
  type StockReviewEntry,
} from '../../offline/stockReconciliation';

interface StockReconciliationPanelProps {
  storeId: number | null;
  /** Current server stock per product, so the owner sees what to count against. */
  serverStock: Map<number, number>;
  onReconciled(): void;
}

interface RowState {
  value: string;
  error: string;
}

const emptyRow: RowState = { value: '', error: '' };

function parseVerifiedStock(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function StockReconciliationPanel({ storeId, serverStock, onReconciled }: StockReconciliationPanelProps) {
  const [reviews, setReviews] = useState<StockReviewEntry[]>([]);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [resolved, setResolved] = useState('');
  // Guards the window between the click and `submitting` reaching the DOM.
  const inFlight = useRef(new Set<number>());

  const loadReviews = useCallback(async () => {
    try {
      setReviews(storeId === null ? [] : await getPendingStockReviews(storeId));
    } catch {
      setReviews([]);
    }
  }, [storeId]);

  useEffect(() => { void loadReviews(); }, [loadReviews]);

  // Stay mounted after the last review clears, so the owner still sees what the
  // confirmation actually did to stock.
  if (!reviews.length && !resolved) return null;

  const rowOf = (productId: number) => rows[productId] ?? emptyRow;
  const setRow = (productId: number, next: Partial<RowState>) => {
    setRows((current) => ({ ...current, [productId]: { ...(current[productId] ?? emptyRow), ...next } }));
  };

  const confirm = async (entry: StockReviewEntry) => {
    if (inFlight.current.has(entry.productId)) return;
    const verifiedStock = parseVerifiedStock(rowOf(entry.productId).value);
    if (verifiedStock === null) {
      setRow(entry.productId, { error: 'กรุณากรอกจำนวนที่ตรวจนับเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป' });
      return;
    }

    inFlight.current.add(entry.productId);
    setSubmitting(entry.productId);
    setRow(entry.productId, { error: '' });
    try {
      const result = await reconcileStock({
        productId: entry.productId,
        verifiedStock,
        reconciliationId: createClientUuid(),
      });
      // Only an accepted adjustment clears the review.
      if (storeId !== null) await resolveStockReview(storeId, entry.productId);
      setRows((current) => {
        const next = { ...current };
        delete next[entry.productId];
        return next;
      });
      setResolved(result.noChange
        ? `${entry.productName} · ยอดตรงกับระบบแล้ว ไม่มีการปรับ`
        : `${entry.productName} · ปรับสต็อก ${result.delta > 0 ? '+' : ''}${result.delta} ชิ้น เหลือ ${result.currentStock} ชิ้น`);
      await loadReviews();
      onReconciled();
    } catch (error) {
      // The typed count is preserved so nothing has to be re-entered.
      setRow(entry.productId, {
        error: error instanceof Error ? error.message : 'ปรับสต็อกไม่สำเร็จ กรุณาลองใหม่',
      });
    } finally {
      inFlight.current.delete(entry.productId);
      setSubmitting(null);
    }
  };

  return (
    <section className="surface stock-reconciliation" aria-labelledby="stock-reconciliation-title">
      <div className="section-heading">
        <div>
          <h2 id="stock-reconciliation-title">{STOCK_REVIEW_HEADING}</h2>
          {reviews.length > 0 && <span>{STOCK_REVIEW_MESSAGE}</span>}
        </div>
      </div>
      {resolved && <p className="reconciliation-resolved" role="status">{resolved}</p>}
      {reviews.length > 0 && <ul className="reconciliation-list">
        {reviews.map((entry) => {
          const row = rowOf(entry.productId);
          const currentStock = serverStock.get(entry.productId) ?? 0;
          const verifiedStock = parseVerifiedStock(row.value);
          const delta = verifiedStock === null ? null : verifiedStock - currentStock;
          const busy = submitting === entry.productId;
          const inputId = `verified-stock-${entry.productId}`;
          return (
            <li key={entry.productId} className="reconciliation-item">
              <div className="reconciliation-product">
                <strong>สินค้า: {entry.productName}</strong>
                <span>{entry.localOrderIds.length} ออเดอร์ออฟไลน์</span>
              </div>
              <dl className="reconciliation-figures">
                <div><dt>Server stock</dt><dd>{currentStock}</dd></div>
                <div><dt>Offline sync review</dt><dd className="is-negative">-{entry.discrepancy}</dd></div>
                <div>
                  <dt>Adjustment</dt>
                  <dd aria-live="polite">{delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}`}</dd>
                </div>
              </dl>
              <div className="reconciliation-entry">
                <label htmlFor={inputId}>ตรวจนับจริง</label>
                <input
                  id={inputId}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={row.value}
                  disabled={busy}
                  onChange={(event) => setRow(entry.productId, { value: event.target.value, error: '' })}
                />
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || verifiedStock === null}
                  onClick={() => { void confirm(entry); }}
                >
                  {busy ? 'กำลังปรับ...' : 'ยืนยันปรับสต็อก'}
                </button>
              </div>
              {row.error && <p className="reconciliation-error" role="alert">{row.error}</p>}
            </li>
          );
        })}
      </ul>}
    </section>
  );
}
