import { useCallback, useEffect, useMemo, useState } from 'react';

import { ErrorState, LoadingState } from '../../components/AsyncState';
import { MutationFeedback } from '../../components/MutationFeedback';
import { PageHeader } from '../../components/PageHeader';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { addToCart, calculateCartTotals, changeGiveawayQuantity, changeQuantity, paidCartQuantity, reconcileCartWithStock, removeFromCart, totalCartQuantity } from '../../domain/cart';
import { formatThaiDateTime } from '../../domain/date';
import { formatCurrency } from '../../domain/format';
import { automaticDiscountState, resetManualDiscount, setManualDiscount } from '../../domain/promotion';
import type { CartItem, DiscountState } from '../../types/domain';
import type { CreateOrderRequest } from '../../types/checkout';
import type { CatalogProduct } from '../../types/products';
import { OFFLINE_AUTHORIZATION_REQUIRED_MESSAGE } from '../../offline/offlineAuthorization';
import { LOCAL_MODE_MESSAGE, PENDING_OFFLINE_ORDERS_MESSAGE } from '../../offline/offlineOrders';
import { useOfflineAuthorization } from '../../offline/useOfflineAuthorization';
import { getPendingStockReviewCount, STOCK_REVIEW_HEADING } from '../../offline/stockReconciliation';
import { useOfflineSync } from '../../offline/useOfflineSync';
import { getUnsyncedOfflineOrders } from '../../offline/offlineOrders';
import { OfflineOrderQueuePanel } from './OfflineOrderQueuePanel';
import { setCheckoutActive } from '../../pwa/updateGate';
import { Cart } from './Cart';
import { CashPaymentModal } from './CashPaymentModal';
import { CategoryTabs } from './CategoryTabs';
import { CloseDayModal } from './CloseDayModal';
import type { CustomerType } from './CustomerSelector';
import { DailyMetrics } from './DailyMetrics';
import { MobileCartBar } from './MobileCartBar';
import { OpeningFloatCard } from './OpeningFloatCard';
import type { PaymentMethod } from './PaymentSelector';
import { ProductGrid } from './ProductGrid';
import { PromptPayModal } from './PromptPayModal';
import { useCheckout } from './useCheckout';
import { useCloseDay } from './useCloseDay';
import { useDailySummary } from './useDailySummary';
import { useIsMobile } from './useIsMobile';
import { useProducts } from './useProducts';
import { usePromptPayQr } from './usePromptPayQr';

const ALL_CATEGORIES = 'ทั้งหมด';

export function SellPage() {
  const { isOnline, isBackendOnline } = useConnectivity();
  const offlineAuthorization = useOfflineAuthorization();
  const productsQuery = useProducts();
  const localMode = productsQuery.unsyncedOfflineOrderCount > 0;
  const dailySummary = useDailySummary();
  const products = useMemo(() => (productsQuery.data ?? []).filter((product) => product.active || product.stock > 0), [productsQuery.data]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountState, setDiscountState] = useState<DiscountState>(automaticDiscountState);
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [customerType, setCustomerType] = useState<CustomerType>('walkin');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [metricsCollapsed, setMetricsCollapsed] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [cashPaymentOpen, setCashPaymentOpen] = useState(false);
  const [promptPayOpen, setPromptPayOpen] = useState(false);
  const [promptPayLocalMode, setPromptPayLocalMode] = useState(false);
  const [qrImageError, setQrImageError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [stockNotice, setStockNotice] = useState('');
  const [holdNotice, setHoldNotice] = useState('');
  const mobile = useIsMobile();
  const checkout = useCheckout();
  const closeDay = useCloseDay(dailySummary.refresh);

  const categories = useMemo(() => [ALL_CATEGORIES, ...new Set(products.map((product) => product.category))], [products]);
  const filteredProducts = selectedCategory === ALL_CATEGORIES ? products : products.filter((product) => product.category === selectedCategory);
  const totals = calculateCartTotals(products, cart, discountState);
  const totalQuantity = totalCartQuantity(cart);
  const paidQuantity = paidCartQuantity(cart);
  const promptPayQr = usePromptPayQr(promptPayOpen, totals.grandTotal, promptPayLocalMode);

  useEffect(() => {
    if (!categories.includes(selectedCategory)) setSelectedCategory(ALL_CATEGORIES);
  }, [categories, selectedCategory]);

  useEffect(() => {
    if (!productsQuery.data) return;
    const reconciliation = reconcileCartWithStock(cart, productsQuery.data);
    if (!reconciliation.adjustedProductIds.length) return;
    setCart(reconciliation.cart);
    setStockNotice('ปรับจำนวนในตะกร้าตามสต็อกล่าสุดจากระบบแล้ว');
    // Reconcile only when a newly confirmed product response arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsQuery.data]);

  useEffect(() => { if (!mobile) setCartOpen(false); }, [mobile]);
  // A waiting service-worker update must not reload the page out from under a
  // sale in progress; it applies once the till is idle again.
  const checkoutActive = cart.length > 0 || cashPaymentOpen || promptPayOpen || checkout.pending;
  useEffect(() => {
    setCheckoutActive(checkoutActive);
    return () => setCheckoutActive(false);
  }, [checkoutActive]);
  // Never drains mid-sale, and only once the backend is genuinely reachable.
  const refreshProducts = productsQuery.refresh;
  // Read from IndexedDB, not from the last sync result, so an outstanding review
  // survives reload and stays visible until it is actually reconciled.
  const [stockReviewCount, setStockReviewCount] = useState(0);
  const [queueCounts, setQueueCounts] = useState({ pending: 0, failed: 0 });
  const [queueRevision, setQueueRevision] = useState(0);
  const loadStockReviews = useCallback(async () => {
    try { setStockReviewCount(await getPendingStockReviewCount()); } catch { setStockReviewCount(0); }
    try {
      const unsynced = await getUnsyncedOfflineOrders();
      setQueueCounts({
        pending: unsynced.filter((entry) => entry.syncStatus === 'pending').length,
        failed: unsynced.filter((entry) => entry.syncStatus === 'failed').length,
      });
    } catch { setQueueCounts({ pending: 0, failed: 0 }); }
  }, []);
  useEffect(() => { void loadStockReviews(); }, [loadStockReviews]);
  const onSyncSettled = useCallback(() => {
    refreshProducts();
    setQueueRevision((current) => current + 1);
    void loadStockReviews();
  }, [loadStockReviews, refreshProducts]);
  const offlineSync = useOfflineSync(
    productsQuery.unsyncedOfflineOrderCount,
    checkoutActive,
    onSyncSettled,
  );
  // Only ever latches towards Local: an open payment modal must never flip back
  // to Cloud under a customer who is already scanning.
  useEffect(() => {
    if (!promptPayOpen || (isBackendOnline && navigator.onLine && !localMode)) return;
    setPromptPayLocalMode(true);
  }, [isBackendOnline, localMode, promptPayOpen]);
  useEffect(() => {
    if (!holdNotice) return;
    const timer = window.setTimeout(() => setHoldNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [holdNotice]);
  useEffect(() => {
    if (!mobile || !cartOpen) return;
    document.body.classList.add('sell-cart-open');
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCartOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.body.classList.remove('sell-cart-open'); document.removeEventListener('keydown', closeOnEscape); };
  }, [cartOpen, mobile]);

  const clearCheckoutFeedback = checkout.clearFeedback;
  const updateCart = (next: CartItem[]) => {
    if (checkout.isLocked()) return;
    setCart(next);
    setStockNotice('');
    setValidationError('');
    clearCheckoutFeedback();
  };
  const clearCart = () => {
    if (checkout.isLocked()) return;
    setCart([]);
    setDiscountState(resetManualDiscount());
    setStockNotice('');
    setValidationError('');
    clearCheckoutFeedback();
  };

  const closePromptPay = useCallback(() => {
    setPromptPayOpen(false);
    setPromptPayLocalMode(false);
    setQrImageError('');
  }, []);
  const closeCashPayment = useCallback(() => setCashPaymentOpen(false), []);

  const submitOrder = async (
    method: PaymentMethod,
    cashDetails?: { amountTendered: number; changeAmount: number },
  ) => {
    if (checkout.isLocked()) return;
    if (!cart.length) {
      setValidationError('ไม่มีสินค้าในตะกร้า');
      return;
    }

    setValidationError('');
    const payload: CreateOrderRequest = {
      items: cart.map((item) => ({ productId: item.productId, qty: item.qty, giveawayQty: item.giveawayQty })),
      paymentMethod: method,
      customerType,
      discount: totals.discount,
    };
    const result = await checkout.submit(payload, cashDetails ? { totals, ...cashDetails } : { totals });
    if (!result) return;

    setCart([]);
    setDiscountState(resetManualDiscount());
    setStockNotice('');
    setCartOpen(false);
    closeCashPayment();
    closePromptPay();
    productsQuery.refresh();
    if (result.mode === 'online') dailySummary.refresh();
  };

  const activatePayment = (method: PaymentMethod) => {
    if (checkout.isLocked()) return;
    if (!isOnline && !offlineAuthorization.authorized) {
      setValidationError(OFFLINE_AUTHORIZATION_REQUIRED_MESSAGE);
      return;
    }
    setPaymentMethod(method);
    setValidationError('');
    checkout.clearFeedback();
    if (!cart.length) {
      setValidationError('ไม่มีสินค้าในตะกร้า');
      return;
    }
    if (method === 'cash') {
      setCartOpen(false);
      setCashPaymentOpen(true);
      return;
    }
    setQrImageError('');
    setPromptPayLocalMode(!isBackendOnline || !navigator.onLine || localMode);
    setCartOpen(false);
    setPromptPayOpen(true);
  };

  const successMessage = checkout.response
    ? `บันทึกออเดอร์ #${checkout.response.orderNumber} - ${formatCurrency(checkout.response.total)}`
    : checkout.offlineOrder
      ? `บันทึกออเดอร์ออฟไลน์ #${checkout.offlineOrder.localOrderNumber} แล้ว · ยังไม่ได้ Sync`
      : '';
  const checkoutError = validationError || checkout.error;

  return <section className="data-page sell-page">
    <div className="sell-page-header">
      <PageHeader title="ขายสินค้า" />
      <button type="button" className="secondary-button close-day-trigger" disabled={closeDay.previewLoading || closeDay.pending || cashPaymentOpen || promptPayOpen || checkout.pending} onClick={() => { void closeDay.openPreview(); }}>
        {closeDay.previewLoading ? 'กำลังสรุปยอด...' : 'สรุป / ปิดยอดวันนี้'}
      </button>
    </div>
    {closeDay.previewError && <MutationFeedback error={closeDay.previewError} success="" />}
    {!cashPaymentOpen && !promptPayOpen && <MutationFeedback error={checkoutError} success={successMessage} />}
    <DailyMetrics summary={dailySummary.data} productCount={products.length} loading={dailySummary.loading} error={dailySummary.error} collapsed={metricsCollapsed} onToggle={() => setMetricsCollapsed((current) => !current)} />
    <OpeningFloatCard cashSales={dailySummary.data?.cashTotal ?? null} />
    {stockNotice && <div className="stock-refresh-notice" role="status">{stockNotice}</div>}
    {productsQuery.storageError && <div className="catalog-storage-warning" role="alert">{productsQuery.storageError}</div>}
    {localMode && <div className="catalog-storage-warning" role="status"><strong>Local Mode · รอ Sync {productsQuery.unsyncedOfflineOrderCount} รายการ</strong>{offlineSync.syncing && <span>กำลัง Sync</span>}{queueCounts.failed > 0 && <span className="sync-status-failed">Sync ไม่สำเร็จ {queueCounts.failed} รายการ</span>}<span>{LOCAL_MODE_MESSAGE}</span><span>{PENDING_OFFLINE_ORDERS_MESSAGE}</span>{offlineSync.error && <span>{offlineSync.error}</span>}<button type="button" className="secondary-button" disabled={offlineSync.syncing || !isBackendOnline || checkoutActive} onClick={() => { void offlineSync.runSync(); }}>{offlineSync.syncing ? 'กำลัง Sync...' : 'Sync ตอนนี้'}</button></div>}
    {!localMode && offlineSync.lastOutcome && offlineSync.lastOutcome.synced > 0 && offlineSync.lastOutcome.remaining === 0 && <div className="sync-status-success" role="status">Sync สำเร็จ · {offlineSync.lastOutcome.synced} รายการ</div>}
    <OfflineOrderQueuePanel revision={queueRevision} syncing={offlineSync.syncing} canRetry={isBackendOnline && !checkoutActive} onRetry={async () => { await offlineSync.runSync(); }} />
    {stockReviewCount > 0 && <div className="catalog-storage-warning" role="alert"><strong>{STOCK_REVIEW_HEADING} · {stockReviewCount} รายการ</strong><span>Sync แล้ว แต่สต็อกบนระบบไม่พอ · ไปที่หน้าจัดการสต็อกเพื่อตรวจนับและยืนยัน</span></div>}
    <div className="sell-workspace">
      <section className="sell-catalog" aria-labelledby="catalog-title">
        <div className="section-heading catalog-heading"><div><h2 id="catalog-title">เมนูของหวาน</h2><span>{products.length} รายการ</span></div><button type="button" className="secondary-button" disabled={productsQuery.loading} onClick={productsQuery.refresh}>{isOnline ? 'รีเฟรชสินค้า' : 'อ่านข้อมูลออฟไลน์อีกครั้ง'}</button></div>
        {productsQuery.isCached && (
          <div className="cached-catalog-status" role="status">
            <strong>{productsQuery.source === 'cache-pending-sync' ? 'ใช้สต็อกในเครื่องระหว่างรอ Sync' : 'ใช้ข้อมูลออฟไลน์ล่าสุด'}</strong>
            <span>อัปเดตล่าสุด {formatThaiDateTime(productsQuery.lastSuccessfulCatalogSyncAt)}</span>
            {productsQuery.source === 'cache-fallback' && productsQuery.error && (
              <span>เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: <span className="cached-catalog-error-detail">{productsQuery.error}</span></span>
            )}
          </div>
        )}
        {productsQuery.data && <CategoryTabs categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />}
        <div aria-live="polite">
          {productsQuery.loading && !productsQuery.data && <LoadingState label="กำลังโหลดสินค้า" />}
          {productsQuery.error && !productsQuery.data && <ErrorState message={productsQuery.error} />}
          {productsQuery.offlineUnavailable && (
            <div className="empty-state offline-catalog-empty" role="status">
              <strong>ยังไม่มีข้อมูลสำหรับใช้งานออฟไลน์</strong>
              <span>กรุณาเชื่อมต่ออินเทอร์เน็ตและเปิดหน้าขายอย่างน้อย 1 ครั้ง</span>
            </div>
          )}
          {productsQuery.data && <ProductGrid products={filteredProducts} cart={cart} onAdd={(product) => updateCart(addToCart(cart, product))} />}
        </div>
      </section>
      <Cart products={products} cart={cart} totals={totals} discountState={discountState} totalQuantity={totalQuantity} paidQuantity={paidQuantity} customerType={customerType} paymentMethod={paymentMethod} mobile={mobile} open={cartOpen} cashPaymentDisabled={checkout.pending || cashPaymentOpen || promptPayOpen || (!isOnline && (offlineAuthorization.checking || !offlineAuthorization.authorized))} promptPayDisabled={checkout.pending || cashPaymentOpen || promptPayOpen || (!isOnline && (offlineAuthorization.checking || !offlineAuthorization.authorized))} checkoutUnavailableMessages={!isOnline && !offlineAuthorization.checking && !offlineAuthorization.authorized ? [OFFLINE_AUTHORIZATION_REQUIRED_MESSAGE] : []} holdNotice={holdNotice} onClose={() => setCartOpen(false)} onClear={clearCart} onQuantityChange={(product: CatalogProduct, delta: number) => updateCart(changeQuantity(cart, product, delta))} onGiveawayChange={(productId, delta) => updateCart(changeGiveawayQuantity(cart, productId, delta))} onRemove={(productId) => updateCart(removeFromCart(cart, productId))} onDiscountChange={(value) => { if (!checkout.isLocked()) { setDiscountState(setManualDiscount(Number.isNaN(value) ? 0 : value)); setValidationError(''); checkout.clearFeedback(); } }} onCustomerChange={(value) => { if (!checkout.isLocked()) setCustomerType(value); }} onPaymentActivate={activatePayment} onHold={() => setHoldNotice('พักออเดอร์แล้ว · รายการยังอยู่ในตะกร้านี้')} />
    </div>
    <button type="button" className={`mobile-cart-backdrop${cartOpen ? ' is-open' : ''}`} aria-label="ปิดตะกร้า" tabIndex={cartOpen ? 0 : -1} onClick={() => setCartOpen(false)} />
    <MobileCartBar count={totalQuantity} total={totals.grandTotal} expanded={cartOpen} onOpen={() => setCartOpen(true)} />
    {cashPaymentOpen && <CashPaymentModal open amount={totals.grandTotal} checkoutError={checkout.error} submitting={checkout.pending} onClose={closeCashPayment} onConfirm={(details) => { void submitOrder('cash', details); }} />}
    <PromptPayModal open={promptPayOpen} amount={totals.grandTotal} localMode={promptPayQr.mode === 'local'} qrUrl={promptPayQr.url} loading={promptPayQr.loading} qrError={qrImageError || promptPayQr.error} qrGuidance={promptPayQr.guidance} checkoutError={checkout.error} submitting={checkout.pending} onClose={closePromptPay} onConfirm={() => { void submitOrder('transfer'); }} onImageError={() => setQrImageError('ไม่สามารถแสดง QR พร้อมเพย์ได้')} />
    <CloseDayModal open={closeDay.open} report={closeDay.report} closedAt={closeDay.closedAt} closureStatusUnavailable={closeDay.closureStatusUnavailable} pending={closeDay.pending} error={closeDay.mutationError} confirmation={closeDay.confirmation} onClose={closeDay.closePreview} onConfirm={() => { void closeDay.confirm(); }} />
  </section>;
}
