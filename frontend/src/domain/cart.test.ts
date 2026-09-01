import { describe, expect, it } from 'vitest';

import {
  addToCart,
  calculateCartTotals,
  changeGiveawayQuantity,
  changeQuantity,
  reconcileCartWithStock,
  remainingStock,
} from './cart';
import type { CartItem, Product } from '../types/domain';

const product: Product = { id: 1, price: 69, stock: 3, category: 'Tiramisu' };

describe('current cart invariants', () => {
  it('adds, increments, decrements, and removes an item', () => {
    let cart = addToCart([], product);
    expect(cart).toEqual([{ productId: 1, qty: 1, giveawayQty: 0 }]);
    cart = addToCart(cart, product);
    expect(cart[0].qty).toBe(2);
    cart = changeQuantity(cart, product, -1);
    expect(cart[0].qty).toBe(1);
    expect(changeQuantity(cart, product, -1)).toEqual([]);
  });

  it('does not increment beyond loaded stock', () => {
    const fullCart: CartItem[] = [{ productId: 1, qty: 3, giveawayQty: 0 }];
    expect(addToCart(fullCart, product)).toEqual(fullCart);
  });

  it('clamps giveaways between zero and total item quantity', () => {
    const cart: CartItem[] = [{ productId: 1, qty: 2, giveawayQty: 0 }];
    expect(changeGiveawayQuantity(cart, 1, 5)[0].giveawayQty).toBe(2);
    expect(changeGiveawayQuantity(cart, 1, -5)[0].giveawayQty).toBe(0);
  });

  it('clamps giveaway quantity when total quantity decreases', () => {
    const cart: CartItem[] = [{ productId: 1, qty: 3, giveawayQty: 3 }];
    expect(changeQuantity(cart, product, -1)[0]).toEqual({
      productId: 1,
      qty: 2,
      giveawayQty: 2,
    });
  });

  it('calculates remaining catalog stock from total cart quantity', () => {
    const cart: CartItem[] = [{ productId: 1, qty: 2, giveawayQty: 1 }];
    expect(remainingStock(product, cart)).toBe(1);
  });

  it('excludes giveaways from paid subtotal while they consume cart stock', () => {
    const cart: CartItem[] = [{ productId: 1, qty: 3, giveawayQty: 2 }];
    const totals = calculateCartTotals([product], cart);
    expect(totals.subtotal).toBe(69);
    expect(remainingStock(product, cart)).toBe(0);
  });

  it('reconciles quantity and giveaways when refreshed backend stock is lower', () => {
    const cart: CartItem[] = [{ productId: 1, qty: 3, giveawayQty: 3 }];
    expect(reconcileCartWithStock(cart, [{ ...product, stock: 2 }])).toEqual({
      cart: [{ productId: 1, qty: 2, giveawayQty: 2 }],
      adjustedProductIds: [1],
    });
  });

  it('removes cart lines no longer present in the active backend catalog', () => {
    const cart: CartItem[] = [{ productId: 1, qty: 1, giveawayQty: 0 }];
    expect(reconcileCartWithStock(cart, [])).toEqual({ cart: [], adjustedProductIds: [1] });
  });
});
