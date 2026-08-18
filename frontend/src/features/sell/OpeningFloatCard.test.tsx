import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpeningFloatCard } from './OpeningFloatCard';

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

function mockCashDay(openingFloat: number | null, save?: (amount: number) => Response) {
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url !== '/api/cash-day') throw new Error(`Unexpected request: ${url}`);
    if (init.method === 'PUT') {
      const amount = JSON.parse(String(init.body)).openingFloat;
      return Promise.resolve(save?.(amount) ?? json({ date: '2026-08-18', openingFloat: amount }));
    }
    return Promise.resolve(json({ date: '2026-08-18', openingFloat }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('OpeningFloatCard', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows the unset state without pretending it is zero', async () => {
    mockCashDay(null);
    render(<OpeningFloatCard cashSales={2450} />);
    expect(await screen.findByText('ยังไม่ได้ตั้งค่า')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ตั้งเงินทอน' })).toBeInTheDocument();
    expect(screen.queryByText('เงินสดที่ควรมี')).not.toBeInTheDocument();
  });

  it('sets and edits the float while calculating expected cash', async () => {
    const fetchMock = mockCashDay(null);
    render(<OpeningFloatCard cashSales={2450} />);
    await screen.findByText('ยังไม่ได้ตั้งค่า');
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งเงินทอน' }));
    fireEvent.change(screen.getByLabelText('เงินทอนตั้งต้น'), { target: { value: '1260' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('฿3,710.00')).toBeInTheDocument();
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit).method === 'PUT');
    expect(putCall).toBeDefined();
    expect(JSON.parse(String((putCall![1] as RequestInit).body))).toEqual({ openingFloat: 1260 });

    fireEvent.click(screen.getByRole('button', { name: 'แก้ไข' }));
    expect(screen.getByLabelText('เงินทอนตั้งต้น')).toHaveValue(1260);
    fireEvent.change(screen.getByLabelText('เงินทอนตั้งต้น'), { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('฿3,950.00')).toBeInTheDocument();
  });

  it('prevents a negative value', async () => {
    mockCashDay(null);
    render(<OpeningFloatCard cashSales={0} />);
    await screen.findByText('ยังไม่ได้ตั้งค่า');
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งเงินทอน' }));
    const dialog = screen.getByRole('dialog', { name: 'เงินทอนตั้งต้นวันนี้' });
    fireEvent.change(within(dialog).getByLabelText('เงินทอนตั้งต้น'), { target: { value: '-1' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('ต้องไม่ติดลบ');
    expect(within(dialog).getByRole('button', { name: 'บันทึก' })).toBeDisabled();
  });

  it('keeps the editor open and shows a backend error safely', async () => {
    mockCashDay(null, () => json({ error: 'บันทึกเงินทอนไม่ได้' }, 500));
    render(<OpeningFloatCard cashSales={0} />);
    await screen.findByText('ยังไม่ได้ตั้งค่า');
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งเงินทอน' }));
    fireEvent.change(screen.getByLabelText('เงินทอนตั้งต้น'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกเงินทอนไม่ได้');
    expect(screen.getByRole('dialog', { name: 'เงินทอนตั้งต้นวันนี้' })).toBeInTheDocument();
  });
});
