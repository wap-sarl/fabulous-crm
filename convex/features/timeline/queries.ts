import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { employeeQuery } from '../../_lib/auth';
import { TIMELINE_KINDS, timelineKindValidator } from '../../_lib/validators/timeline';
import { isNotDeleted } from '../../lib/shared/db';
import { paginateTimeline } from '../../lib/timeline/pagination';
import type { TimelineEvent } from '../../lib/timeline/events';
import { docLoader, SOURCES } from '../../lib/timeline/sources';

export const listLeadTimeline = employeeQuery({
  args: {
    leadId: v.id('leads'),
    kinds: v.optional(v.array(timelineKindValidator)),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !isNotDeleted(lead)) {
      return { page: [] as TimelineEvent[], isDone: true, continueCursor: '' };
    }
    const kinds = TIMELINE_KINDS.filter((k) => !args.kinds || args.kinds.includes(k));
    const loader = docLoader(ctx);
    return paginateTimeline(
      kinds.map((kind) => SOURCES[kind](ctx, args.leadId, loader)),
      args.paginationOpts,
    );
  },
});
