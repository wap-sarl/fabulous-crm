import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { employeeAction } from '../../_lib/auth';
import { authComponent } from '../../auth';
import type { ContactArchive } from './internal';

/** Right of access: the archive of everything the CRM holds about one contact, for the settings holders; audited. */
export const exportContactData = employeeAction({
  args: { leadId: v.id('leads') },
  handler: async (
    ctx,
    { leadId },
  ): Promise<{ requestId: Id<'rgpdRequests'>; archive: ContactArchive }> => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    const access: { userId: Id<'users'>; visible: boolean } | null = authUser
      ? await ctx.runQuery(internal.features.rgpd.internal.exportAccessOf, {
          authId: authUser._id,
          leadId,
        })
      : null;
    if (!access) throw new Error('Unauthorized: settings access');
    // Out of the role's perimeter reads like a contact that does not exist, as everywhere else.
    if (!access.visible) throw new Error('lead_not_found');
    const archive: ContactArchive | null = await ctx.runQuery(
      internal.features.rgpd.internal.collectContactData,
      { leadId },
    );
    if (!archive) throw new Error('lead_not_found');
    const requestId: Id<'rgpdRequests'> = await ctx.runMutation(
      internal.features.rgpd.internal.recordAccess,
      { leadId, userId: access.userId, cut: archive.cut },
    );
    return { requestId, archive };
  },
});
