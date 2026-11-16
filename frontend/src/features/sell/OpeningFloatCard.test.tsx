import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitForElementToBeRemoved, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpeningFloatCard } from './OpeningFloatCard';

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body } as Response;
}

function mockCashDay(openingFloat: number | null, save?: (amount: number) => Response, denominations: Record<string, number> | null = null) {
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url !== '/api/cash-day') throw new Error(`Unexpected request: ${url}`);
    if (init.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      return Promise.resolve(save?.(body.openingFloat) ?? json({ date: '2026-08-18', openingFloat: body.openingFloat, denominations: body.denominations ?? null }));
    }
    return Promise.resolve(json({ date: '2026-08-18', openingFloat, denominations }));
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
    expect(screen.getByLabelText('เงินทอนตั้งต้น')).toHaveValue('1260');
    fireEvent.change(screen.getByLabelText('เงินทอนตั้งต้น'), { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('฿3,950.00')).toBeInTheDocument();
  });

  it('refuses to accept a negative or non-numeric amount at all', async () => {
    mockCashDay(null);
    render(<OpeningFloatCard cashSales={0} />);
    await screen.findByText('ยังไม่ได้ตั้งค่า');
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งเงินทอน' }));
    const dialog = screen.getByRole('dialog', { name: 'เงินทอนตั้งต้นวันนี้' });
    const field = within(dialog).getByLabelText('เงินทอนตั้งต้น');

    // The keystroke is rejected outright, so no invalid value ever lands in the
    // field and there is nothing to warn about.
    for (const rejected of ['-1', 'abc', '1e5', '12.345', '1..2', '+5']) {
      fireEvent.change(field, { target: { value: rejected } });
      expect(field).toHaveValue('');
    }
    expect(within(dialog).getByRole('button', { name: 'บันทึก' })).toBeDisabled();

    // Digits and satang still go through.
    fireEvent.change(field, { target: { value: '1250.50' } });
    expect(field).toHaveValue('1250.50');
    expect(within(dialog).getByRole('button', { name: 'บันทึก' })).toBeEnabled();
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

  const totalField = () => screen.getByLabelText('เงินทอนตั้งต้น');
  const countField = (denomination: number) => screen.getByLabelText(`จำนวน ${denomination} บาท`);

  async function openEditor(openingFloat: number | null = null, denominations: Record<string, number> | null = null) {
    const fetchMock = mockCashDay(openingFloat, undefined, denominations);
    render(<OpeningFloatCard cashSales={2450} />);
    const label = openingFloat === null ? 'ตั้งเงินทอน' : 'แก้ไข';
    const trigger = await screen.findByRole('button', { name: label });
    // The trigger renders disabled until the cash day has loaded; clicking it
    // before then silently does nothing and the dialog never opens.
    await vi.waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'เงินทอนตั้งต้นวันนี้' });
    return fetchMock;
  }

  it('adds the counted notes and coins into the total', async () => {
    await openEditor();

    fireEvent.change(countField(1000), { target: { value: '2' } });
    fireEvent.change(countField(100), { target: { value: '5' } });
    fireEvent.change(countField(5), { target: { value: '20' } });

    // 2000 + 500 + 100
    expect(totalField()).toHaveValue('2600');
    expect(screen.getByText('฿2,000.00')).toBeInTheDocument();
    expect(screen.getByText('฿100.00')).toBeInTheDocument();
  });

  const putBodies = (fetchMock: ReturnType<typeof mockCashDay>) => fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit)?.method === 'PUT')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

  it('saves the counted notes along with the total', async () => {
    const fetchMock = await openEditor();

    fireEvent.change(countField(500), { target: { value: '3' } });
    fireEvent.change(countField(20), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await vi.waitFor(() => {
      expect(putBodies(fetchMock)).toEqual([{ openingFloat: 1580, denominations: { '500': 3, '20': 4 } }]);
    });
  });

  it('saves a hand-typed total without a breakdown', async () => {
    const fetchMock = await openEditor();

    fireEvent.change(totalField(), { target: { value: '1250' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await vi.waitFor(() => expect(putBodies(fetchMock)).toEqual([{ openingFloat: 1250 }]));
  });

  it('clears the breakdown when the total is typed by hand', async () => {
    await openEditor();

    fireEvent.change(countField(100), { target: { value: '3' } });
    expect(totalField()).toHaveValue('300');

    fireEvent.change(totalField(), { target: { value: '1250' } });

    // No stale counts left implying a breakdown that no longer adds up.
    expect(countField(100)).toHaveValue('');
    expect(totalField()).toHaveValue('1250');
  });

  it('ignores a non-numeric or negative count without breaking the total', async () => {
    await openEditor();

    fireEvent.change(countField(100), { target: { value: '2' } });
    fireEvent.change(countField(50), { target: { value: '-3' } });
    fireEvent.change(countField(20), { target: { value: 'abc' } });

    expect(totalField()).toHaveValue('200');
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeEnabled();
  });

  it('empties the total when every count is cleared', async () => {
    await openEditor();

    fireEvent.change(countField(100), { target: { value: '2' } });
    expect(totalField()).toHaveValue('200');

    fireEvent.change(countField(100), { target: { value: '' } });

    expect(totalField()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDisabled();
  });

  it('leaves the counts blank when the saved float was typed by hand', async () => {
    await openEditor(1500);

    expect(totalField()).toHaveValue('1500');
    // The stored float prefills the total, never a fabricated breakdown.
    expect(countField(1000)).toHaveValue('');
    expect(countField(100)).toHaveValue('');
  });

  it('brings back the saved count so one face can be corrected', async () => {
    const fetchMock = await openEditor(1580, { '500': 3, '20': 4 });

    expect(countField(500)).toHaveValue('3');
    expect(countField(20)).toHaveValue('4');
    expect(countField(100)).toHaveValue('');
    expect(totalField()).toHaveValue('1580');

    // One more 20 found in the drawer: change only that line.
    fireEvent.change(countField(20), { target: { value: '5' } });
    expect(totalField()).toHaveValue('1600');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await vi.waitFor(() => {
      expect(putBodies(fetchMock)).toEqual([{ openingFloat: 1600, denominations: { '500': 3, '20': 5 } }]);
    });
  });

  it('keeps the count it just saved when the editor is reopened', async () => {
    await openEditor();

    fireEvent.change(countField(100), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitForElementToBeRemoved(() => screen.queryByRole('dialog', { name: 'เงินทอนตั้งต้นวันนี้' }));

    fireEvent.click(screen.getByRole('button', { name: 'แก้ไข' }));
    expect(countField(100)).toHaveValue('5');
    expect(totalField()).toHaveValue('500');
  });
});
