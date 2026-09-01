import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CashPaymentModal } from './CashPaymentModal';

describe('CashPaymentModal', () => {
  afterEach(() => {
    cleanup();
    document.body.classList.remove('cash-payment-open');
  });

  it('calculates change and blocks confirmation below the grand total', () => {
    const onConfirm = vi.fn();
    render(<CashPaymentModal open amount={138} checkoutError="" submitting={false} onClose={vi.fn()} onConfirm={onConfirm} />);

    const confirm = screen.getByRole('button', { name: 'ยืนยันรับเงิน' });
    expect(screen.getByText('฿138.00')).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('จำนวนเงินที่รับ'), { target: { value: '100' } });
    expect(confirm).toBeDisabled();
    expect(screen.getByText('฿0.00')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('จำนวนเงินที่รับ'), { target: { value: '200' } });
    expect(screen.getByText('฿62.00')).toBeInTheDocument();
    expect(confirm).toBeEnabled();
  });

  it('supports exact and appropriate denomination shortcuts', () => {
    render(<CashPaymentModal open amount={620} checkoutError="" submitting={false} onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '100' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '500' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1000' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Exact' }));
    expect(screen.getByLabelText('จำนวนเงินที่รับ')).toHaveValue('620');
    expect(screen.getByText('฿0.00')).toBeInTheDocument();
  });

  it('confirms once valid and respects the checkout lock', () => {
    const onConfirm = vi.fn();
    const view = render(<CashPaymentModal open amount={69} checkoutError="" submitting={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: '100' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันรับเงิน' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ amountTendered: 100, changeAmount: 31 });

    view.rerender(<CashPaymentModal open amount={69} checkoutError="" submitting onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: 'ยืนยันรับเงิน' })).toBeDisabled();
    expect(screen.getByLabelText('จำนวนเงินที่รับ')).toBeDisabled();
  });
});
