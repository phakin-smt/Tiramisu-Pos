import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { AppRoutes } from './router';

describe('placeholder application routes', () => {
  afterEach(() => {
    cleanup();
  });

  it('redirects the root route to the sell placeholder', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'ขาย' })).toBeInTheDocument();
  });

  it('renders a directly loaded placeholder route', async () => {
    render(
      <MemoryRouter initialEntries={['/stock']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'สต็อก' })).toBeInTheDocument();
  });
});
