import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { ConvexProvider, bootstrapPrimaryColor } from '@crm/widgets';
import App from './app';
import './styles.css';

// Paints the last-known brand accent before the first render, so nothing flashes the theme default while the config loads.
bootstrapPrimaryColor();

// A tab opened before a deployment asks for a page whose file is gone: load the new build, once, so a file really missing does not loop.
window.addEventListener('vite:preloadError', () => {
  const key = 'crm:reloaded-for-build';
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    return;
  }
  window.location.reload();
});

const convexUrl = window.__ENV__?.VITE_CONVEX_URL ?? import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error('VITE_CONVEX_URL environment variable is required');
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <StrictMode>
    <ConvexProvider url={convexUrl}>
      <App />
    </ConvexProvider>
  </StrictMode>,
);
