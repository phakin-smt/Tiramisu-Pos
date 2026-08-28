import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectivityProvider } from '../connectivity/ConnectivityContext';
import { AuthProvider } from '../features/auth/AuthContext';
import { readOfflineAuthorization, refreshOfflineAuthorization } from '../offline/offlineAuthorization';
import { readOfflinePaymentConfig } from '../offline/paymentConfig';
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
    <ConnectivityProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </ConnectivityProvider>,
  );
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

async function submitPin(pin = '2468') {
  fireEvent.change(await screen.findByLabelText('PIN'), { target: { value: pin } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('authentication and application shell', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setNavigatorOnline(true);
  });

  it('shows the application shell for an initially authenticated session', async () => {
    mockResponses(
      { body: { authenticated: true, configured: true } },
      { body: { configured: true, merchantAccountInfo: '0016A00000067701011101130066801234567', version: 1 } },
    );
    renderApplication('/sell');
    expect(await screen.findByRole('heading', { name: 'ขายสินค้า' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'เมนูหลัก' })).toBeInTheDocument();
    await vi.waitFor(async () => expect((await readOfflineAuthorization()).authorized).toBe(true));
    await vi.waitFor(async () => expect(await readOfflinePaymentConfig()).toMatchObject({
      merchantAccountInfo: '0016A00000067701011101130066801234567',
      version: 1,
    }));
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
      <ConnectivityProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/sell']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </ConnectivityProvider>,
    );
    const loginCalls = fetchMock.mock.calls.filter(([url, init]) =>
      url === '/api/auth/login' && (init as RequestInit).method === 'POST');
    expect(loginCalls).toHaveLength(1);
    await vi.waitFor(async () => expect((await readOfflineAuthorization()).authorized).toBe(true));
  });

  const storageScenarios: Array<[string, Partial<StorageManager> | undefined]> = [
    ['rejects the request', { persist: async (): Promise<boolean> => { throw new Error('permission database unavailable'); } }],
    ['refuses persistence', { persist: async () => false, persisted: async () => false }],
    ['has no Storage API', undefined],
  ];

  it.each(storageScenarios)('logs in and provisions the device even when the browser %s', async (_label, storage) => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
    try {
      mockResponses(
        { body: { authenticated: false, configured: true } },
        { body: { authenticated: true, configured: true } },
      );
      renderApplication('/sell');
      await submitPin();

      expect(await screen.findByRole('heading', { name: 'ขายสินค้า' })).toBeInTheDocument();
      // Trusted-device provisioning must survive a storage failure beside it.
      await vi.waitFor(async () => expect((await readOfflineAuthorization()).authorized).toBe(true));
      expect(await screen.findByText(/อุปกรณ์นี้อาจลบข้อมูลออฟไลน์/)).toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(navigator, 'storage', original);
      else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'storage');
    }
  });

  it('reports durable storage without warning the cashier when persistence is granted', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist: async () => true, persisted: async () => false },
    });
    try {
      mockResponses(
        { body: { authenticated: false, configured: true } },
        { body: { authenticated: true, configured: true } },
      );
      renderApplication('/sell');
      await submitPin();

      expect(await screen.findByRole('heading', { name: 'ขายสินค้า' })).toBeInTheDocument();
      await vi.waitFor(async () => expect((await readOfflineAuthorization()).authorized).toBe(true));
      expect(screen.queryByText(/อุปกรณ์นี้อาจลบข้อมูลออฟไลน์/)).not.toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(navigator, 'storage', original);
      else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'storage');
    }
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

  it('renders the application shell and honest status when an authorized device is offline', async () => {
    await refreshOfflineAuthorization();
    setNavigatorOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderApplication('/orders');

    expect(await screen.findByRole('heading', { name: 'ออเดอร์' })).toBeInTheDocument();
    expect(screen.getAllByRole('status').some(
      (status) => status.textContent?.includes('Offline'),
    )).toBe(true);
    expect(screen.getByRole('note')).toHaveTextContent('ขายเงินสดและ PromptPay ได้บนอุปกรณ์ที่ได้รับอนุญาต');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/status')).toBe(false);
  });

  it('locks the offline workspace on a device that holds no trusted-device authorization', async () => {
    setNavigatorOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderApplication('/orders');

    // Airplane mode must not open the till on an unprovisioned device.
    expect(await screen.findByText('อุปกรณ์นี้ยังไม่ได้รับอนุญาตให้ใช้งานออฟไลน์')).toBeInTheDocument();
    expect(screen.getByText('กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเข้าสู่ระบบด้วย PIN อีกครั้ง')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ออเดอร์' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs out and removes access to the shell with one mutation', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/status') return Promise.resolve(response({ body: { authenticated: true, configured: true } }));
      if (url === '/api/products') return Promise.resolve(response({ body: [] }));
      if (url === '/api/reports/daily-summary') return Promise.resolve(response({ body: { date: '2026-08-17', orderCount: 0, cashTotal: 0, transferTotal: 0, totalRevenue: 0 } }));
      if (url === '/api/cash-day') return Promise.resolve(response({ body: { date: '2026-08-17', openingFloat: null } }));
      if (url === '/api/auth/logout') return Promise.resolve(response({ body: { authenticated: false, configured: true } }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
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
      if (url === '/api/cash-day') return Promise.resolve(response({ body: { date: '2026-08-17', openingFloat: null } }));
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
