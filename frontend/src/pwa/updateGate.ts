/**
 * Holds a waiting service-worker update until the till is idle.
 *
 * `autoUpdate` reloads the page the moment a new build lands, and the cart lives
 * only in React state — a deploy during trading hours would silently discard a
 * half-built order or a QR the customer is mid-scan. State is module-local by
 * design: no storage, nothing to persist, nothing to leak between devices.
 */

let checkoutActive = false;
let pendingUpdate: (() => void) | null = null;

function applyWhenIdle(): void {
  if (checkoutActive || !pendingUpdate) return;
  const apply = pendingUpdate;
  pendingUpdate = null;
  apply();
}

/**
 * Marks whether a sale is in progress: a non-empty cart, an open payment modal,
 * or a checkout still in flight.
 */
export function setCheckoutActive(active: boolean): void {
  if (checkoutActive === active) return;
  checkoutActive = active;
  applyWhenIdle();
}

/** Queues a service-worker update, applying it immediately if nothing is at risk. */
export function queueServiceWorkerUpdate(apply: () => void): void {
  pendingUpdate = apply;
  applyWhenIdle();
}

export function isCheckoutActive(): boolean {
  return checkoutActive;
}

export function hasPendingServiceWorkerUpdate(): boolean {
  return pendingUpdate !== null;
}

/** Test-only reset so module state cannot leak between cases. */
export function resetServiceWorkerUpdateGate(): void {
  checkoutActive = false;
  pendingUpdate = null;
}
