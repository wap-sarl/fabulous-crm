import type { EeFrontend } from '../contract';

// Paid build of the SPA: `@crm/ee` resolves here when Vite runs with EE=1 (tsconfig.ee.json). No paid module exists yet.
export const eeFrontend: EeFrontend = { bundled: true, features: [] };
