import { useEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { navigationItems } from './navigation';

const TABLET_QUERY = '(min-width: 768px) and (max-width: 1199px)';
const SWIPE_THRESHOLD = 80;
const HORIZONTAL_DOMINANCE = 1.25;
const INTERACTIVE_SELECTOR = [
  'form', 'input', 'select', 'textarea', 'button', 'a', 'table',
  '[role="dialog"]', '[aria-modal="true"]', '[data-swipe-ignore]',
  '.modal-overlay', '.promptpay-overlay', '.close-day-overlay',
  '.sales-chart', '.table-scroll', '.stock-adjustment-controls',
  '.category-tabs', '.sell-cart-items', '.close-day-content',
].join(', ');
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], .modal-overlay, .promptpay-overlay, .close-day-overlay';
const routes: readonly string[] = navigationItems.map((item) => item.path);

export function useTabletSwipeNavigation(containerRef: RefObject<HTMLElement | null>) {
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let start: { x: number; y: number } | null = null;

    const reset = () => { start = null; };
    const touchStart = (event: TouchEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!window.matchMedia(TABLET_QUERY).matches
        || event.touches.length !== 1
        || document.querySelector(MODAL_SELECTOR)
        || target?.closest(INTERACTIVE_SELECTOR)) {
        reset();
        return;
      }
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };
    const touchEnd = (event: TouchEvent) => {
      if (!start || event.changedTouches.length !== 1 || !window.matchMedia(TABLET_QUERY).matches || document.querySelector(MODAL_SELECTOR)) {
        reset();
        return;
      }
      const deltaX = event.changedTouches[0].clientX - start.x;
      const deltaY = event.changedTouches[0].clientY - start.y;
      reset();
      if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * HORIZONTAL_DOMINANCE) return;
      const currentIndex = routes.indexOf(locationRef.current);
      if (currentIndex < 0) return;
      const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex >= 0 && nextIndex < routes.length) navigate(routes[nextIndex]);
    };

    container.addEventListener('touchstart', touchStart, { passive: true });
    container.addEventListener('touchend', touchEnd, { passive: true });
    container.addEventListener('touchcancel', reset, { passive: true });
    return () => {
      container.removeEventListener('touchstart', touchStart);
      container.removeEventListener('touchend', touchEnd);
      container.removeEventListener('touchcancel', reset);
    };
  }, [containerRef, navigate]);
}
