import type { CartItem as CartItemModel, CartTotals as Totals, DiscountState } from '../../types/domain';
import type { CatalogProduct } from '../../types/products';
import { CartItem } from './CartItem';
import { CartTotals } from './CartTotals';
import { CustomerSelector, type CustomerType } from './CustomerSelector';
import { PaymentSelector, type PaymentMethod } from './PaymentSelector';

interface CartProps {
  products: readonly CatalogProduct[]; cart: readonly CartItemModel[]; totals: Totals; discountState: DiscountState;
  totalQuantity: number; paidQuantity: number; customerType: CustomerType; paymentMethod: PaymentMethod; mobile: boolean; open: boolean;
  paymentDisabled: boolean;
  checkoutUnavailableMessage: string;
  holdNotice: string;
  onClose(): void; onClear(): void; onQuantityChange(product: CatalogProduct, delta: number): void;
  onGiveawayChange(productId: number, delta: number): void; onRemove(productId: number): void;
  onDiscountChange(value: number): void; onCustomerChange(value: CustomerType): void; onPaymentActivate(value: PaymentMethod): void;
  onHold(): void;
}

export function Cart({ products, cart, totals, discountState, totalQuantity, paidQuantity, customerType, paymentMethod, mobile, open, paymentDisabled, checkoutUnavailableMessage, holdNotice, onClose, onClear, onQuantityChange, onGiveawayChange, onRemove, onDiscountChange, onCustomerChange, onPaymentActivate, onHold }: CartProps) {
  return <aside id="sell-cart" className={`sell-cart${open ? ' is-open' : ''}`} aria-label="ออเดอร์ปัจจุบัน" role={mobile ? 'dialog' : undefined} aria-modal={mobile || undefined} aria-hidden={mobile ? !open : undefined} inert={mobile && !open}>
    <header className="sell-cart-header">
      <div><h2>ออเดอร์ปัจจุบัน</h2><span>{totalQuantity} ชิ้น</span></div>
      <button type="button" className="danger-text-button" disabled={!cart.length} onClick={onClear}>ล้าง</button>
      <button type="button" className="icon-button mobile-cart-close" aria-label="ปิดตะกร้า" onClick={onClose}>×</button>
    </header>
    <CustomerSelector value={customerType} onChange={onCustomerChange} />
    <div className="sell-cart-items" aria-live="polite">
      {!cart.length && <div className="empty-state">ยังไม่มีสินค้าในตะกร้า</div>}
      {cart.map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId);
        return product ? <CartItem key={item.productId} item={item} product={product} onQuantityChange={(delta) => onQuantityChange(product, delta)} onGiveawayChange={(delta) => onGiveawayChange(product.id, delta)} onRemove={() => onRemove(product.id)} /> : null;
      })}
    </div>
    <CartTotals totals={totals} discountState={discountState} totalQuantity={totalQuantity} paidQuantity={paidQuantity} onDiscountChange={onDiscountChange} />
    <PaymentSelector value={paymentMethod} disabled={paymentDisabled} onActivate={onPaymentActivate} />
    {checkoutUnavailableMessage && <p className="offline-checkout-message" role="status">{checkoutUnavailableMessage}</p>}
    <div className="hold-order-controls">
      <button type="button" className="secondary-button" onClick={onHold}>พักออเดอร์</button>
      {holdNotice && <span role="status">{holdNotice}</span>}
    </div>
  </aside>;
}
