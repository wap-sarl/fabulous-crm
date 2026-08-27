import { type Infer, v } from 'convex/values';

export const auditLogEntityTypeValidator = v.union(
  v.literal('lead'),
  v.literal('company'),
  v.literal('deal'),
  v.literal('pipeline'),
  v.literal('activity'),
  v.literal('attachment'),
  v.literal('employee'),
  v.literal('campaign'),
  v.literal('appConfig'),
  v.literal('invitation'),
  v.literal('propertyDefinition'),
  v.literal('leadNote'),
  v.literal('leadList'),
  v.literal('workflow'),
  v.literal('workflowRun'),
);

export const auditLogActionValidator = v.union(
  v.literal('create'),
  v.literal('update'),
  v.literal('delete'),
  v.literal('merge'),
);

export const auditLogValidator = v.object({
  entityType: auditLogEntityTypeValidator,
  entityId: v.string(),
  action: auditLogActionValidator,
  userId: v.id('users'),
  timestamp: v.number(),
  metadata: v.optional(v.any()),
});

export type AuditLog = Infer<typeof auditLogValidator>;
export type AuditLogEntityType = Infer<typeof auditLogEntityTypeValidator>;
export type AuditLogAction = Infer<typeof auditLogActionValidator>;
