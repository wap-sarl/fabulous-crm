import { defineApp } from 'convex/server';
import aggregate from '@convex-dev/aggregate/convex.config';
import betterAuth from '@convex-dev/better-auth/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';

const app = defineApp();
app.use(betterAuth);
app.use(aggregate, { name: 'leadListMemberCounts' });
app.use(aggregate, { name: 'leadsByStatus' });
app.use(aggregate, { name: 'leadsByOwner' });
app.use(rateLimiter);

export default app;
