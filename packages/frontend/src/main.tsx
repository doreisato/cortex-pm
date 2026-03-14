import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './design-system/cortex.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('[PWA] Service worker registration failed', err);
    });
  });
}
