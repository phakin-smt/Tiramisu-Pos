import { formatCurrency } from '../../domain/format';
import type { CartItem as CartItemModel } from '../../types/domain';
import type { CatalogProduct } from '../../types/products';

interface CartItemProps { item: CartItemModel; product: CatalogProduct; onQuantityChange(delta: number): void; onGiveawayChange(delta: number): void; onRemove(): void; }

export function CartItem({ item, product, onQuantityChange, onGiveawayChange, onRemove }: CartItemProps) {
  const paidQuantity = item.qty - item.giveawayQty;
  return <article className="sell-cart-item">
    <span className="cart-item-icon" aria-hidden="true">{product.icon || '□'}</span>
    <div className="cart-item-content">
      <div className="cart-item-title"><strong>{product.name}</strong><span>{formatCurrency(product.price * paidQuantity)}</span></div>
      <small>{formatCurrency(product.price)} × {item.qty}{item.giveawayQty ? ` · แถม ${item.giveawayQty}` : ''}</small>
      <div className="cart-control-row"><span>จำนวน</span><div className="counter-control">
        <button type="button" aria-label={`ลดจำนวน ${product.name}`} onClick={() => onQuantityChange(-1)}>−</button>
        <output aria-label={`จำนวน ${product.name}`}>{item.qty}</output>
        <button type="button" aria-label={`เพิ่มจำนวน ${product.name}`} disabled={item.qty >= product.stock} onClick={() => onQuantityChange(1)}>+</button>
      </div></div>
      <div className="cart-control-row giveaway-row"><span>แถม</span><div className="counter-control">
        <button type="button" aria-label={`ลดจำนวนแถม ${product.name}`} disabled={item.giveawayQty <= 0} onClick={() => onGiveawayChange(-1)}>−</button>
        <output aria-label={`จำนวนแถม ${product.name}`}>{item.giveawayQty}</output>
        <button type="button" aria-label={`เพิ่มจำนวนแถม ${product.name}`} disabled={item.giveawayQty >= item.qty} onClick={() => onGiveawayChange(1)}>+</button>
      </div></div>
    </div>
    <button type="button" className="cart-remove-button" aria-label={`นำ ${product.name} ออกจากตะกร้า`} onClick={onRemove}>×</button>
  </article>;
}
