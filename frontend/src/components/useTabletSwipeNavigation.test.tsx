import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';

import { useTabletSwipeNavigation } from './useTabletSwipeNavigation';

function Harness() {
  const ref = useRef<HTMLElement>(null);
  const location = useLocation();
  useTabletSwipeNavigation(ref);
  return <main ref={ref} data-testid="surface">
    <span data-testid="route">{location.pathname}</span>
    <button type="button">Interactive</button>
    <div className="table-scroll"><span>Table region</span></div>
  </main>;
}

function tablet(matches = true) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches, media: '', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
}

function swipe(target: Element, startX: number, startY: number, endX: number, endY: number) {
  fireEvent.touchStart(target, { touches: [{ clientX: startX, clientY: startY }] });
  fireEvent.touchEnd(target, { changedTouches: [{ clientX: endX, clientY: endY }] });
}

describe('tablet swipe navigation', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('moves through all six routes without wrapping at either boundary', () => {
    tablet();
    render(<MemoryRouter initialEntries={['/sell']}><Harness /></MemoryRouter>);
    const surface = screen.getByTestId('surface');
    swipe(surface, 100, 100, 220, 100);
    expect(screen.getByTestId('route')).toHaveTextContent('/sell');
    for (const route of ['/stock', '/orders', '/reports', '/analytics', '/settings']) {
      swipe(surface, 220, 100, 100, 100);
      expect(screen.getByTestId('route')).toHaveTextContent(route);
    }
    swipe(surface, 220, 100, 100, 100);
    expect(screen.getByTestId('route')).toHaveTextContent('/settings');
  });

  it('ignores short and vertically dominant gestures', () => {
    tablet();
    render(<MemoryRouter initialEntries={['/sell']}><Harness /></MemoryRouter>);
    const surface = screen.getByTestId('surface');
    swipe(surface, 200, 100, 140, 100);
    swipe(surface, 220, 100, 100, 260);
    expect(screen.getByTestId('route')).toHaveTextContent('/sell');
  });

  it('ignores controls, scrollable table regions, and open modals', () => {
    tablet();
    render(<MemoryRouter initialEntries={['/sell']}><Harness /></MemoryRouter>);
    swipe(screen.getByRole('button', { name: 'Interactive' }), 220, 100, 100, 100);
    swipe(screen.getByText('Table region'), 220, 100, 100, 100);
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    swipe(screen.getByTestId('surface'), 220, 100, 100, 100);
    modal.remove();
    expect(screen.getByTestId('route')).toHaveTextContent('/sell');
  });

  it('does not activate outside tablet media widths', () => {
    tablet(false);
    render(<MemoryRouter initialEntries={['/sell']}><Harness /></MemoryRouter>);
    swipe(screen.getByTestId('surface'), 220, 100, 100, 100);
    expect(screen.getByTestId('route')).toHaveTextContent('/sell');
  });
});
