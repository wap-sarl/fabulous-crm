import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';

/**
 * Runs one batch and schedules the next. A mutation that throws is rolled back whole and Convex does not retry it,
 * so the wrapper marks the job interrupted with the error; a resume schedules the same batch again.
 */
export const runBatch = internalAction({
  args: { jobId: v.id('importJobs'), batch: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, batch }) => {
    try {
      const { more } = await ctx.runMutation(internal.features.imports.internal.runBatch, {
        jobId,
        batch,
      });
      if (more) {
        await ctx.scheduler.runAfter(0, internal.features.imports.actions.runBatch, {
          jobId,
          batch: batch + 1,
        });
      }
    } catch (e) {
      await ctx.runMutation(internal.features.imports.internal.markInterrupted, {
        jobId,
        batch,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  },
});
