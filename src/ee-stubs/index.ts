import type { EeFrontend } from '../../ee/contract';

// Community build of the SPA: `@crm/ee` resolves here (see vite.config.mts and tsconfig.json).
export const eeFrontend: EeFrontend = { bundled: false, features: [] };
