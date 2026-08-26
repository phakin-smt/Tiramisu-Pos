import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './styles/global.css';
import { registerSW } from 'virtual:pwa-register';
import { queueServiceWorkerUpdate } from './pwa/updateGate';

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Never mid-sale: the gate applies this once the cart is empty and no
    // payment modal is open.
    queueServiceWorkerUpdate(() => { void updateServiceWorker(true); });
  },
  onRegisterError(error) {
    console.error('Service worker registration failed', error);
  },
});

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element was not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
