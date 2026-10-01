import type { api } from '@crm/lib/backend';
import type { FunctionReturnType } from 'convex/server';

/** The upload size and trash retention limits as the query gives them. */
export type AttachmentLimits = FunctionReturnType<
  typeof api.features.attachments.queries.getAttachmentLimits
>;
