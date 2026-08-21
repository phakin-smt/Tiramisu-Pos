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
import { LOCAL_MODE_MESSAGE, LOCAL_MODE_PROMPTPAY_MESSAGE, OFFLINE_PROMPTPAY_MESSAGE, PENDING_OFFLINE_ORDERS_MESSAGE } from '../../offline/offlineOrders';
import { useOfflineAuthorization } from '../../offline/useOfflineAuthorization';
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
  const { isOnline } = useConnectivity();
  const offlineAuthorization = useOfflineAuthorization();
  const productsQuery = useProducts();
  const localMode = productsQuery.pendingOfflineOrderCount > 0;
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
  const promptPayQr = usePromptPayQr(promptPayOpen && isOnline && !localMode, totals.grandTotal);

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
  useEffect(() => {
    if (isOnline && !localMode) return;
    setPromptPayOpen(false);
    setQrImageError('');
  }, [isOnline, localMode]);
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
    const result = await checkout.submit(payload, cashDetails ? { totals, ...cashDetails } : undefined);
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
    if ((!isOnline || localMode) && method === 'transfer') {
      setValidationError(localMode ? LOCAL_MODE_PROMPTPAY_MESSAGE : OFFLINE_PROMPTPAY_MESSAGE);
      return;
    }
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
    {localMode && <div className="catalog-storage-warning" role="status"><strong>Local Mode · รอ Sync {productsQuery.pendingOfflineOrderCount} รายการ</strong><span>{LOCAL_MODE_MESSAGE}</span><span>{PENDING_OFFLINE_ORDERS_MESSAGE}</span></div>}
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
      <Cart products={products} cart={cart} totals={totals} discountState={discountState} totalQuantity={totalQuantity} paidQuantity={paidQuantity} customerType={customerType} paymentMethod={paymentMethod} mobile={mobile} open={cartOpen} cashPaymentDisabled={checkout.pending || cashPaymentOpen || promptPayOpen || (!isOnline && (offlineAuthorization.checking || !offlineAuthorization.authorized))} promptPayDisabled={!isOnline || localMode || checkout.pending || cashPaymentOpen || promptPayOpen} checkoutUnavailableMessages={localMode ? [LOCAL_MODE_PROMPTPAY_MESSAGE] : !isOnline ? [OFFLINE_PROMPTPAY_MESSAGE, ...(!offlineAuthorization.checking && !offlineAuthorization.authorized ? [OFFLINE_AUTHORIZATION_REQUIRED_MESSAGE] : [])] : []} holdNotice={holdNotice} onClose={() => setCartOpen(false)} onClear={clearCart} onQuantityChange={(product: CatalogProduct, delta: number) => updateCart(changeQuantity(cart, product, delta))} onGiveawayChange={(productId, delta) => updateCart(changeGiveawayQuantity(cart, productId, delta))} onRemove={(productId) => updateCart(removeFromCart(cart, productId))} onDiscountChange={(value) => { if (!checkout.isLocked()) { setDiscountState(setManualDiscount(Number.isNaN(value) ? 0 : value)); setValidationError(''); checkout.clearFeedback(); } }} onCustomerChange={(value) => { if (!checkout.isLocked()) setCustomerType(value); }} onPaymentActivate={activatePayment} onHold={() => setHoldNotice('พักออเดอร์แล้ว · รายการยังอยู่ในตะกร้านี้')} />
    </div>
    <button type="button" className={`mobile-cart-backdrop${cartOpen ? ' is-open' : ''}`} aria-label="ปิดตะกร้า" tabIndex={cartOpen ? 0 : -1} onClick={() => setCartOpen(false)} />
    <MobileCartBar count={totalQuantity} total={totals.grandTotal} expanded={cartOpen} onOpen={() => setCartOpen(true)} />
    {cashPaymentOpen && <CashPaymentModal open amount={totals.grandTotal} checkoutError={checkout.error} submitting={checkout.pending} onClose={closeCashPayment} onConfirm={(details) => { void submitOrder('cash', details); }} />}
    <PromptPayModal open={promptPayOpen} amount={totals.grandTotal} qrUrl={promptPayQr.url} loading={promptPayQr.loading} qrError={qrImageError || promptPayQr.error} checkoutError={checkout.error} submitting={checkout.pending} onClose={closePromptPay} onConfirm={() => { void submitOrder('transfer'); }} onImageError={() => setQrImageError('ไม่สามารถแสดง QR พร้อมเพย์ได้')} />
    <CloseDayModal open={closeDay.open} report={closeDay.report} closedAt={closeDay.closedAt} closureStatusUnavailable={closeDay.closureStatusUnavailable} pending={closeDay.pending} error={closeDay.mutationError} confirmation={closeDay.confirmation} onClose={closeDay.closePreview} onConfirm={() => { void closeDay.confirm(); }} />
  </section>;
}
