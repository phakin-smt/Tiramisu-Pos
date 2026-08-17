import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../features/auth/AuthContext';
import { AppRoutes } from './router';

interface MockResponse {
  status?: number;
  body: unknown;
}

function response({ status = 200, body }: MockResponse): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

function mockResponses(...items: MockResponse[]) {
  const fetchMock = vi.fn();
  items.forEach((item) => fetchMock.mockResolvedValueOnce(response(item)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderApplication(path = '/') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
}

async function submitPin(pin = '2468') {
  fireEvent.change(await screen.findByLabelText('PIN'), { target: { value: pin } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('authentication and application shell', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the application shell for an initially authenticated session', async () => {
    mockResponses({ body: { authenticated: true, configured: true } });
    renderApplication('/sell');
    expect(await screen.findByRole('heading', { name: 'ขายสินค้า' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'เมนูหลัก' })).toBeInTheDocument();
  });

  it('shows login and denies shell access for an unauthenticated session', async () => {
    mockResponses({ body: { authenticated: false, configured: true } });
    renderApplication('/stock');
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'จัดการสต็อก' })).not.toBeInTheDocument();
  });

  it('logs in with a valid PIN without duplicating the mutation on rerender', async () => {
    const fetchMock = mockResponses(
      { body: { authenticated: false, configured: true } },
      { body: { authenticated: true, configured: true } },
    );
    const view = renderApplication('/sell');
    await submitPin();
    expect(await screen.findByRole('heading', { name: 'ขายสินค้า' })).toBeInTheDocument();
    view.rerender(
      <AuthProvider>
        <MemoryRouter initialEntries={['/sell']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>,
    );
    const loginCalls = fetchMock.mock.calls.filter(([url, init]) =>
      url === '/api/auth/login' && (init as RequestInit).method === 'POST');
    expect(loginCalls).toHaveLength(1);
  });

  it.each([
    [401, 'PIN ไม่ถูกต้อง'],
    [429, 'ลอง PIN ผิดหลายครั้ง กรุณารอ 5 นาที'],
    [503, 'ระบบ PIN ยังไม่ได้ตั้งค่า'],
  ])('shows backend login error for status %i', async (status, message) => {
    mockResponses(
      { body: { authenticated: false, configured: true } },
      { status, body: { error: message } },
    );
    renderApplication();
    await submitPin('0000');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText(/Session expired/i)).not.toBeInTheDocument();
  });

  it('shows the unconfigured server state and disables login', async () => {
    mockResponses({ body: { authenticated: false, configured: false } });
    renderApplication();
    expect(await screen.findByRole('alert')).toHaveTextContent('PIN authentication is not configured.');
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDisabled();
  });

  it('shows a backend connection failure without crashing routing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    renderApplication('/reports');
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect to the server.');
    expect(screen.queryByRole('heading', { name: 'รายงาน' })).not.toBeInTheDocument();
  });

  it('logs out and removes access to the shell with one mutation', async () => {
    const fetchMock = mockResponses(
      { body: { authenticated: true, configured: true } },
      { body: [] },
      { body: { date: '2026-08-17', orderCount: 0, cashTotal: 0, transferTotal: 0, totalRevenue: 0 } },
      { body: { authenticated: false, configured: true } },
    );
    renderApplication('/sell');
    const logoutButton = (await screen.findAllByRole('button', { name: 'ออกจากระบบ' }))[0];
    fireEvent.click(logoutButton);
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'เมนูหลัก' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/logout')).toHaveLength(1);
  });

  it('returns to login when an ordinary JSON API request receives 401', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/status') return Promise.resolve(response({ body: { authenticated: true, configured: true } }));
      if (url === '/api/products') return Promise.resolve(response({ status: 401, body: { error: 'กรุณาเข้าสู่ระบบใหม่' } }));
      if (url === '/api/reports/daily-summary') return Promise.resolve(response({ body: { date: '2026-08-17', orderCount: 0, cashTotal: 0, transferTotal: 0, totalRevenue: 0 } }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderApplication('/sell');
    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired. Please log in again.');
  });

  it('redirects the default and unknown routes to sell', async () => {
    mockResponses({ body: { authenticated: true, configured: true } });
    renderApplication('/');
    expect(await screen.findByRole('heading', { name: 'ขายสินค้า' })).toBeInTheDocument();
    cleanup();

    mockResponses({ body: { authenticated: true, configured: true } });
    renderApplication('/unknown');
    expect(await screen.findByRole('heading', { name: 'ขายสินค้า' })).toBeInTheDocument();
  });

  it.each([
    ['จัดการสต็อก', 'จัดการสต็อก'],
    ['ออเดอร์', 'ออเดอร์'],
    ['รายงาน', 'รายงาน'],
    ['วิเคราะห์', 'วิเคราะห์'],
    ['ตั้งค่า', 'ตั้งค่า'],
  ])('navigates to %s and exposes active state', async (linkName, heading) => {
    mockResponses({ body: { authenticated: true, configured: true } });
    renderApplication('/sell');
    const navigation = await screen.findByRole('navigation', { name: 'เมนูหลัก' });
    const link = within(navigation).getByRole('link', { name: linkName });
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('exposes separately named desktop and mobile navigation landmarks', async () => {
    mockResponses({ body: { authenticated: true, configured: true } });
    renderApplication('/analytics');
    await screen.findByRole('heading', { name: 'วิเคราะห์' });
    expect(screen.getByRole('navigation', { name: 'เมนูหลัก' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'เมนูมือถือ' })).toBeInTheDocument();
    const activeLinks = screen.getAllByRole('link').filter(
      (link) => link.getAttribute('aria-current') === 'page',
    );
    expect(activeLinks).toHaveLength(2);
  });
});
