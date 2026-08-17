import { calculateTotals } from './promotion';
import type { CartItem, CartTotals, DiscountState, Product } from '../types/domain';

function findItem(cart: readonly CartItem[], productId: number): CartItem | undefined {
  return cart.find((item) => item.productId === productId);
}

export function addToCart(cart: readonly CartItem[], product: Product): CartItem[] {
  return changeQuantity(cart, product, 1);
}

export function changeQuantity(
  cart: readonly CartItem[],
  product: Product,
  delta: number,
): CartItem[] {
  const current = findItem(cart, product.id);

  if (!current) {
    if (delta <= 0 || delta > product.stock) return [...cart];
    return [...cart, { productId: product.id, qty: delta, giveawayQty: 0 }];
  }

  const nextQuantity = current.qty + delta;
  if (delta > 0 && nextQuantity > product.stock) return [...cart];
  if (nextQuantity <= 0) return cart.filter((item) => item.productId !== product.id);

  return cart.map((item) =>
    item.productId === product.id
      ? { ...item, qty: nextQuantity, giveawayQty: Math.min(item.giveawayQty, nextQuantity) }
      : item,
  );
}

export function changeGiveawayQuantity(
  cart: readonly CartItem[],
  productId: number,
  delta: number,
): CartItem[] {
  return cart.map((item) =>
    item.productId === productId
      ? {
          ...item,
          giveawayQty: Math.min(item.qty, Math.max(0, item.giveawayQty + delta)),
        }
      : item,
  );
}

export function cartQuantity(cart: readonly CartItem[], productId: number): number {
  return findItem(cart, productId)?.qty ?? 0;
}

export function remainingStock(product: Product, cart: readonly CartItem[]): number {
  return product.stock - cartQuantity(cart, product.id);
}

export function calculateCartTotals(
  products: readonly Product[],
  cart: readonly CartItem[],
  discountState?: DiscountState,
): CartTotals {
  const lines = cart.flatMap((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return product
      ? [{ unitPrice: product.price, quantity: item.qty, giveawayQuantity: item.giveawayQty }]
      : [];
  });

  return calculateTotals(lines, discountState);
}
