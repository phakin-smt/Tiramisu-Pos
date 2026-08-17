import { useCallback, useEffect, useMemo, useState } from 'react';

import { ErrorState, LoadingState } from '../../components/AsyncState';
import { MutationFeedback } from '../../components/MutationFeedback';
import { PageHeader } from '../../components/PageHeader';
import { addToCart, calculateCartTotals, changeGiveawayQuantity, changeQuantity, paidCartQuantity, reconcileCartWithStock, removeFromCart, totalCartQuantity } from '../../domain/cart';
import { formatCurrency } from '../../domain/format';
import { automaticDiscountState, resetManualDiscount, setManualDiscount } from '../../domain/promotion';
import type { CartItem, DiscountState } from '../../types/domain';
import type { CreateOrderRequest } from '../../types/checkout';
import type { CatalogProduct } from '../../types/products';
import { Cart } from './Cart';
import { CategoryTabs } from './CategoryTabs';
import type { CustomerType } from './CustomerSelector';
import { DailyMetrics } from './DailyMetrics';
import { MobileCartBar } from './MobileCartBar';
import type { PaymentMethod } from './PaymentSelector';
import { ProductGrid } from './ProductGrid';
import { PromptPayModal } from './PromptPayModal';
import { useCheckout } from './useCheckout';
import { useDailySummary } from './useDailySummary';
import { useIsMobile } from './useIsMobile';
import { useProducts } from './useProducts';
import { usePromptPayQr } from './usePromptPayQr';

const ALL_CATEGORIES = 'ทั้งหมด';

export function SellPage() {
  const productsQuery = useProducts();
  const dailySummary = useDailySummary();
  const products = useMemo(() => (productsQuery.data ?? []).filter((product) => product.active), [productsQuery.data]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountState, setDiscountState] = useState<DiscountState>(automaticDiscountState);
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [customerType, setCustomerType] = useState<CustomerType>('walkin');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [metricsCollapsed, setMetricsCollapsed] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [promptPayOpen, setPromptPayOpen] = useState(false);
  const [qrImageError, setQrImageError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [stockNotice, setStockNotice] = useState('');
  const mobile = useIsMobile();
  const checkout = useCheckout();

  const categories = useMemo(() => [ALL_CATEGORIES, ...new Set(products.map((product) => product.category))], [products]);
  const filteredProducts = selectedCategory === ALL_CATEGORIES ? products : products.filter((product) => product.category === selectedCategory);
  const totals = calculateCartTotals(products, cart, discountState);
  const totalQuantity = totalCartQuantity(cart);
  const paidQuantity = paidCartQuantity(cart);
  const promptPayQr = usePromptPayQr(promptPayOpen, totals.grandTotal);

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

  const submitOrder = async (method: PaymentMethod) => {
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
    const response = await checkout.submit(payload);
    if (!response) return;

    setCart([]);
    setDiscountState(resetManualDiscount());
    setStockNotice('');
    setCartOpen(false);
    closePromptPay();
    productsQuery.refresh();
    dailySummary.refresh();
  };

  const activatePayment = (method: PaymentMethod) => {
    if (checkout.isLocked()) return;
    setPaymentMethod(method);
    setValidationError('');
    checkout.clearFeedback();
    if (method === 'cash') {
      void submitOrder('cash');
      return;
    }
    if (!cart.length) {
      setValidationError('ไม่มีสินค้าในตะกร้า');
      return;
    }
    setQrImageError('');
    setCartOpen(false);
    setPromptPayOpen(true);
  };

  const successMessage = checkout.response
    ? `บันทึกออเดอร์ #${checkout.response.orderNumber} - ${formatCurrency(checkout.response.total)}`
    : '';
  const checkoutError = validationError || checkout.error;

  return <section className="data-page sell-page">
    <PageHeader title="ขายสินค้า" />
    {!promptPayOpen && <MutationFeedback error={checkoutError} success={successMessage} />}
    <DailyMetrics summary={dailySummary.data} productCount={products.length} loading={dailySummary.loading} error={dailySummary.error} collapsed={metricsCollapsed} onToggle={() => setMetricsCollapsed((current) => !current)} />
    {stockNotice && <div className="stock-refresh-notice" role="status">{stockNotice}</div>}
    <div className="sell-workspace">
      <section className="sell-catalog" aria-labelledby="catalog-title">
        <div className="section-heading catalog-heading"><div><h2 id="catalog-title">เมนูของหวาน</h2><span>{products.length} รายการ</span></div><button type="button" className="secondary-button" disabled={productsQuery.loading} onClick={productsQuery.refresh}>รีเฟรชสินค้า</button></div>
        {productsQuery.data && <CategoryTabs categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />}
        <div aria-live="polite">
          {productsQuery.loading && !productsQuery.data && <LoadingState label="กำลังโหลดสินค้า" />}
          {productsQuery.error && <ErrorState message={productsQuery.error} />}
          {productsQuery.data && <ProductGrid products={filteredProducts} cart={cart} onAdd={(product) => updateCart(addToCart(cart, product))} />}
        </div>
      </section>
      <Cart products={products} cart={cart} totals={totals} discountState={discountState} totalQuantity={totalQuantity} paidQuantity={paidQuantity} customerType={customerType} paymentMethod={paymentMethod} mobile={mobile} open={cartOpen} paymentDisabled={checkout.pending || promptPayOpen} onClose={() => setCartOpen(false)} onClear={clearCart} onQuantityChange={(product: CatalogProduct, delta: number) => updateCart(changeQuantity(cart, product, delta))} onGiveawayChange={(productId, delta) => updateCart(changeGiveawayQuantity(cart, productId, delta))} onRemove={(productId) => updateCart(removeFromCart(cart, productId))} onDiscountChange={(value) => { if (!checkout.isLocked()) { setDiscountState(setManualDiscount(Number.isNaN(value) ? 0 : value)); setValidationError(''); checkout.clearFeedback(); } }} onCustomerChange={(value) => { if (!checkout.isLocked()) setCustomerType(value); }} onPaymentActivate={activatePayment} />
    </div>
    <button type="button" className={`mobile-cart-backdrop${cartOpen ? ' is-open' : ''}`} aria-label="ปิดตะกร้า" tabIndex={cartOpen ? 0 : -1} onClick={() => setCartOpen(false)} />
    <MobileCartBar count={totalQuantity} total={totals.grandTotal} expanded={cartOpen} onOpen={() => setCartOpen(true)} />
    <PromptPayModal open={promptPayOpen} amount={totals.grandTotal} qrUrl={promptPayQr.url} loading={promptPayQr.loading} qrError={qrImageError || promptPayQr.error} checkoutError={checkout.error} submitting={checkout.pending} onClose={closePromptPay} onConfirm={() => { void submitOrder('transfer'); }} onImageError={() => setQrImageError('ไม่สามารถแสดง QR พร้อมเพย์ได้')} />
  </section>;
}
