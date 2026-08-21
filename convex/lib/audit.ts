import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { AuditLogAction, AuditLogEntityType } from '../_lib/validators/auditLogs';

export function createAuditFields(userId: Id<'users'>) {
  return {
    updatedAt: Date.now(),
    createdBy: userId,
    updatedBy: userId,
  };
}

export function updateAuditFields(userId: Id<'users'>) {
  return {
    updatedAt: Date.now(),
    updatedBy: userId,
  };
}

export async function logAudit(params: {
  ctx: MutationCtx;
  userId: Id<'users'>;
  entityType: AuditLogEntityType;
  entityId: string;
  action: AuditLogAction;
  metadata?: unknown;
}) {
  await params.ctx.db.insert('auditLogs', {
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    userId: params.userId,
    timestamp: Date.now(),
    metadata: params.metadata,
  });
}

export function computeChanges(
  current: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> | undefined {
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const [key, newValue] of Object.entries(updates)) {
    if (newValue !== undefined && JSON.stringify(current[key]) !== JSON.stringify(newValue)) {
      changes[key] = { old: current[key], new: newValue };
    }
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}
