import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './i18n';
import { useStore } from './store';
import './styles.css';

// e2e hook: expose the store so Playwright can drive the browse root without a
// native folder dialog. Gated on the DMWS_E2E flag (off in normal use).
if (window.api?.isE2E) {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}

createRoot(document.getElementById('root')!).render(<App />);
