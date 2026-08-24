import { defineApp } from 'convex/server';
import aggregate from '@convex-dev/aggregate/convex.config';
import betterAuth from '@convex-dev/better-auth/convex.config';

const app = defineApp();
app.use(betterAuth);
app.use(aggregate, { name: 'leadListMemberCounts' });

export default app;
