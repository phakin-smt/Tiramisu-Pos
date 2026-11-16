import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorePaymentQrSection } from './StorePaymentQrSection';

// Preparing the picture needs a canvas and createImageBitmap, neither of which
// jsdom has. Its own rules are covered in domain/paymentQrImage.test.ts.
const prepareQrForUpload = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,UVI='));
vi.mock('../../domain/paymentQrImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../domain/paymentQrImage')>()),
  prepareQrForUpload,
}));

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

const SHARED = { configured: true, mode: 'promptpay', merchantAccountInfo: '0016A00000067701011101130066801234567', version: 1 };
const NONE = { configured: false, mode: 'none', version: 1 };
const OWN = { configured: true, mode: 'image', imageUrl: '/api/store/payment-qr?v=abc123', imageChecksum: 'abc123', version: 1 };

function mockQr(handler?: (url: string, init: RequestInit) => Response | undefined, config: unknown = SHARED) {
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const custom = handler?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url === '/api/offline-payment-config') return Promise.resolve(json(config));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function choose() {
  fireEvent.change(screen.getByLabelText(/รูป QR/), {
    target: { files: [new File(['qr'], 'qr.png', { type: 'image/png' })] },
  });
}

describe('StorePaymentQrSection', () => {
  beforeEach(() => { prepareQrForUpload.mockClear(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('draws the shared QR a shop without its own is paid through, and names the account', async () => {
    mockQr();
    render(<StorePaymentQrSection />);
    expect(await screen.findByText('ยังไม่ได้ตั้ง QR ของร้าน — ใช้ QR พร้อมเพย์กลาง')).toBeInTheDocument();
    const qr = await screen.findByRole('img', { name: 'QR พร้อมเพย์กลาง' });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByText(/พร้อมเพย์ลงท้าย 4567/)).toBeInTheDocument();
    expect(screen.getByLabelText('เลือกรูป QR ของร้าน')).toHaveAttribute('accept', 'image/*');
    expect(screen.queryByRole('button', { name: 'ลบ QR' })).not.toBeInTheDocument();
  });

  it('says transfers cannot be taken when there is no QR at all, instead of claiming a shared one', async () => {
    mockQr(undefined, NONE);
    render(<StorePaymentQrSection />);
    expect(await screen.findByText('ยังรับโอนไม่ได้ — ร้านนี้ยังไม่มี QR')).toBeInTheDocument();
    expect(screen.getByText(/ลูกค้าจะโอนเงินไม่ได้/)).toBeInTheDocument();
    expect(screen.queryByText(/QR พร้อมเพย์กลาง/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('admits it could not check, and can try again, rather than guessing', async () => {
    let fail = true;
    mockQr((url) => (url === '/api/offline-payment-config' && fail ? json({ error: 'offline' }, 503) : undefined));
    render(<StorePaymentQrSection />);
    expect(await screen.findByText('ตรวจสอบ QR ไม่ได้')).toBeInTheDocument();
    expect(screen.queryByText(/QR พร้อมเพย์กลาง/)).not.toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(await screen.findByText('ยังไม่ได้ตั้ง QR ของร้าน — ใช้ QR พร้อมเพย์กลาง')).toBeInTheDocument();
  });

  it('can drop a chosen picture without saving it', async () => {
    const fetchMock = mockQr();
    render(<StorePaymentQrSection />);
    await screen.findByRole('img', { name: 'QR พร้อมเพย์กลาง' });
    choose();
    expect(await screen.findByRole('img', { name: 'QR รับเงินของร้าน' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.getByRole('img', { name: 'QR พร้อมเพย์กลาง' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'บันทึก QR' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/store/payment-qr')).toBe(false);
  });

  it('shows the shop its own QR when it has one', async () => {
    mockQr(undefined, OWN);
    render(<StorePaymentQrSection />);
    expect(await screen.findByText('ร้านนี้ใช้ QR ของร้านเอง')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'QR รับเงินของร้าน' })).toHaveAttribute('src', OWN.imageUrl);
    expect(screen.getByRole('button', { name: 'ลบ QR' })).toBeInTheDocument();
  });

  it('holds a chosen picture locally until it is saved', async () => {
    const fetchMock = mockQr((url, init) => url === '/api/store/payment-qr' && init.method === 'PUT'
      ? json({ storeId: 1, imageUrl: '/api/store/payment-qr?v=new' })
      : undefined);
    render(<StorePaymentQrSection />);
    await screen.findByText(/ยังไม่ได้ตั้ง/);
    choose();

    // Chosen but not sent: nothing has reached the server yet.
    expect(await screen.findByRole('img', { name: 'QR รับเงินของร้าน' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/store/payment-qr')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก QR' }));
    expect(await screen.findByRole('status')).toHaveTextContent('บันทึก QR ของร้านแล้ว');
    const upload = fetchMock.mock.calls.find(([url]) => String(url) === '/api/store/payment-qr');
    expect(upload?.[1]?.method).toBe('PUT');
    expect(JSON.parse(String(upload?.[1]?.body))).toEqual({ image: 'data:image/png;base64,UVI=' });
  });

  it('warns that the customer will have to key the amount in', async () => {
    mockQr();
    render(<StorePaymentQrSection />);
    await screen.findByText(/ยังไม่ได้ตั้ง/);
    choose();
    expect(await screen.findByText(/ลูกค้าจะต้องกรอกยอดเอง/)).toBeInTheDocument();
  });

  it('reports a picture it cannot prepare instead of sending it', async () => {
    prepareQrForUpload.mockRejectedValueOnce(new Error('รูป QR ใหญ่เกินไป ลองถ่ายใหม่หรือครอบให้เหลือเฉพาะ QR'));
    const fetchMock = mockQr();
    render(<StorePaymentQrSection />);
    await screen.findByText(/ยังไม่ได้ตั้ง/);
    choose();
    expect(await screen.findByRole('alert')).toHaveTextContent('รูป QR ใหญ่เกินไป');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/store/payment-qr')).toBe(false);
  });

  it('confirms before dropping the shop back to the shared QR', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = mockQr((url, init) => url === '/api/store/payment-qr' && init.method === 'DELETE'
      ? json({ storeId: 1, imageUrl: null })
      : undefined, OWN);
    render(<StorePaymentQrSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'ลบ QR' }));
    expect(await screen.findByRole('status')).toHaveTextContent('ลบ QR ของร้านแล้ว');
    const removed = fetchMock.mock.calls.find(([url]) => String(url) === '/api/store/payment-qr');
    expect(removed?.[1]?.method).toBe('DELETE');
  });

  it('keeps the QR when the deletion is not confirmed', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const fetchMock = mockQr(undefined, OWN);
    render(<StorePaymentQrSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'ลบ QR' }));
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/store/payment-qr')).toBe(false);
    expect(screen.getByRole('img', { name: 'QR รับเงินของร้าน' })).toBeInTheDocument();
  });
});
