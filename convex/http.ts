import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { extensions } from './extensions';
import { registerApiRoutes } from './features/api/routes';
import { registerCampaignsRoutes } from './features/campaigns/routes';
import { registerConnectorsRoutes } from './features/connectors/routes';
import { registerFormsRoutes } from './features/forms/routes';
import { registerTrackingRoutes } from './features/tracking/routes';

const http = httpRouter();

// Each feature registers its own routes.
registerCampaignsRoutes(http);
registerConnectorsRoutes(http);
registerFormsRoutes(http);
registerTrackingRoutes(http);

// Public REST API (/api/v1/): see features/api/routes.ts.
extensions.registerHttpRoutes(http);
registerApiRoutes(http);

// `cors: true` lets the SPA, served from another origin than this deployment, call `/api/auth/*`; the allowed origins are the `trustedOrigins` of `createAuth`.
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
