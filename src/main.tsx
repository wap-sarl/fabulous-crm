import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { ConvexProvider, bootstrapPrimaryColor } from '@crm/widgets';
import App from './app';
import './styles.css';

// Paints the last-known brand accent before the first render, so nothing flashes the theme default while the config loads.
bootstrapPrimaryColor();

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
