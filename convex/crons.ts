import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Retention: what is older than the configured days goes, one bounded page at a time (features/retention).
crons.daily(
  'retention purge',
  { hourUTC: 3, minuteUTC: 30 },
  internal.features.retention.internal.runPurge,
  {},
);

// An erasure whose step failed is scheduled again (features/rgpd); the step is idempotent.
crons.hourly(
  'rgpd erasure resume',
  { minuteUTC: 20 },
  internal.features.rgpd.internal.resumeStalledErasures,
  {},
);

// A campaign being sent whose chain of calls broke, while a send is due, is drained again (lib/campaigns/drain.ts).
crons.hourly(
  'campaign drains restart',
  { minuteUTC: 40 },
  internal.features.campaigns.internal.restartStuckDrains,
  {},
);

// Every half hour, so that a zone thirty minutes off the hour is on time: once the organisation's clock has reached its hour, each person is told of their tasks due today (lib/notifications/due.ts).
crons.cron(
  'tasks due today',
  '0,30 * * * *',
  internal.features.notifications.internal.tellTasksDue,
  {},
);

export default crons;
