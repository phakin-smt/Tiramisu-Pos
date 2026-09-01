import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PromptPayModal } from './PromptPayModal';

const noop = () => {};

function renderModal(overrides: Partial<Parameters<typeof PromptPayModal>[0]> = {}) {
  const props = {
    open: true,
    amount: 69,
    localMode: false,
    qrUrl: 'blob:qr-1',
    loading: false,
    qrError: '',
    qrGuidance: '',
    checkoutError: '',
    submitting: false,
    onClose: noop,
    onConfirm: noop,
    onImageError: noop,
    ...overrides,
  };
  const view = render(<PromptPayModal {...props} />);
  return { ...view, rerender: (next: Partial<typeof props>) => view.rerender(<PromptPayModal {...props} {...next} />) };
}

const confirmButton = () => screen.getByRole('button', { name: /ยืนยันว่าโอนแล้ว/ });

describe('PromptPayModal readiness', () => {
  afterEach(() => {
    cleanup();
    document.body.classList.remove('promptpay-open');
  });

  it('blocks confirmation until the QR image for the current URL has loaded', () => {
    renderModal();
    expect(confirmButton()).toBeDisabled();
    fireEvent.load(screen.getByRole('img'));
    expect(confirmButton()).toBeEnabled();
  });

  it('stays enabled when a load event is followed by an unrelated rerender', () => {
    const { rerender } = renderModal();
    fireEvent.load(screen.getByRole('img'));
    expect(confirmButton()).toBeEnabled();

    // The exact shape of the old bug: a re-render right after load must not
    // reset readiness, because no second load event would ever arrive.
    rerender({ localMode: true });
    rerender({ checkoutError: 'ลองใหม่อีกครั้ง' });
    expect(confirmButton()).toBeEnabled();
  });

  it('re-blocks confirmation when the QR URL changes and re-enables on the new load', () => {
    const { rerender } = renderModal();
    fireEvent.load(screen.getByRole('img'));
    expect(confirmButton()).toBeEnabled();

    rerender({ qrUrl: 'blob:qr-2' });
    expect(confirmButton()).toBeDisabled();

    fireEvent.load(screen.getByRole('img'));
    expect(confirmButton()).toBeEnabled();
  });

  it('never latches permanently disabled across a Cloud to Local QR swap', () => {
    // Drives the Cloud -> Local transition the way connectivity loss does:
    // loading, then a fresh local URL, with a load event on every commit.
    const { rerender } = renderModal({ qrUrl: '', loading: true });
    expect(confirmButton()).toBeDisabled();

    rerender({ qrUrl: 'blob:cloud', loading: false });
    fireEvent.load(screen.getByRole('img'));
    expect(confirmButton()).toBeEnabled();

    rerender({ qrUrl: '', loading: true, localMode: true });
    expect(confirmButton()).toBeDisabled();

    rerender({ qrUrl: 'blob:local', loading: false, localMode: true });
    fireEvent.load(screen.getByRole('img'));
    expect(confirmButton()).toBeEnabled();
  });

  it('reports an image failure and keeps confirmation blocked', () => {
    const onImageError = vi.fn();
    const { rerender } = renderModal({ onImageError });
    fireEvent.load(screen.getByRole('img'));
    expect(confirmButton()).toBeEnabled();

    fireEvent.error(screen.getByRole('img'));
    expect(onImageError).toHaveBeenCalledTimes(1);
    expect(confirmButton()).toBeDisabled();

    rerender({ qrError: 'ไม่สามารถแสดง QR พร้อมเพย์ได้' });
    expect(confirmButton()).toBeDisabled();
  });

  it('keeps confirmation blocked while a checkout is submitting', () => {
    const { rerender } = renderModal();
    fireEvent.load(screen.getByRole('img'));
    rerender({ submitting: true });
    expect(screen.getByRole('button', { name: 'กำลังบันทึก...' })).toBeDisabled();
  });
});
