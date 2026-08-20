import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConnectivityProvider, useConnectivity } from './ConnectivityContext';

function ConnectivityProbe() {
  const { isOnline } = useConnectivity();
  return <output>{isOnline ? 'online' : 'offline'}</output>;
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

describe('ConnectivityProvider', () => {
  afterEach(() => {
    cleanup();
    setNavigatorOnline(true);
  });

  it('tracks browser online and offline events', () => {
    setNavigatorOnline(true);
    render(
      <ConnectivityProvider>
        <ConnectivityProbe />
      </ConnectivityProvider>,
    );

    expect(screen.getByText('online')).toBeInTheDocument();

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('offline')).toBeInTheDocument();

    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByText('online')).toBeInTheDocument();
  });
});
