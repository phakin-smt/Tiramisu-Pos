import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './styles/global.css';
import { registerSW } from 'virtual:pwa-register';

registerSW({
  immediate: true,
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
