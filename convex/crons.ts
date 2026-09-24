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

export default crons;
