import type { Doc, Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import type { ActivityImportRow } from '../../../_lib/validators/imports';
import type { PropertyValue } from '../../../_lib/validators/properties';
import { createActivityRecord } from '../../../lib/activities';
import { computeChanges, logAudit, updateAuditFields } from '../../../lib/audit';
import { filterUndefined, isNotDeleted } from '../../../lib/dbHelpers';
import { findLeadByEmail, normalizeEmail } from '../../../lib/leadImport';
import {
  loadPropertyDefsById,
  type PropertyDefinitionDoc,
  sanitizeCustomProperties,
} from '../../../lib/properties';
import type { EntityImporter } from './types';

interface Caches {
  propertyDefsById: Map<string, PropertyDefinitionDoc>;
  leadByEmail: Map<string, Doc<'leads'> | null>;
  companyByName: Map<string, Doc<'companies'> | null>;
}

interface Resolved {
  title: string;
  leadId: Id<'leads'> | undefined;
  companyId: Id<'companies'> | undefined;
  customProperties: Record<string, PropertyValue> | undefined;
}

type State =
  | { kind: 'error'; error: string }
  | ({ kind: 'create' } & Resolved)
  | ({ kind: 'update'; activity: Doc<'activities'> } & Resolved);

const fold = (s: string) => s.trim().toLowerCase();

async function leadOf(ctx: MutationCtx, caches: Caches, email: string): Promise<Doc<'leads'>> {
  if (!caches.leadByEmail.has(email))
    caches.leadByEmail.set(email, await findLeadByEmail(ctx, email));
  const lead = caches.leadByEmail.get(email);
  if (!lead || !isNotDeleted(lead)) throw new Error('contact_not_found');
  return lead;
}

async function companyOf(
  ctx: MutationCtx,
  caches: Caches,
  name: string,
): Promise<Doc<'companies'>> {
  if (!caches.companyByName.has(name)) {
    const rows = await ctx.db
      .query('companies')
      .withIndex('by_name', (q) => q.eq('name', name))
      .take(20);
    caches.companyByName.set(name, rows.find(isNotDeleted) ?? null);
  }
  const company = caches.companyByName.get(name);
  if (!company) throw new Error('company_not_found');
  return company;
}

/** The live activity of that contact with the same title and date: a file imported twice updates rather than doubles. */
async function matchActivity(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  row: ActivityImportRow,
  title: string,
): Promise<Doc<'activities'> | null> {
  const rows = await ctx.db
    .query('activities')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .take(200);
  return (
    rows.find((a) => isNotDeleted(a) && fold(a.title) === fold(title) && a.dueAt === row.dueAt) ??
    null
  );
}

export const activityImporter: EntityImporter<ActivityImportRow, Caches, State> = {
  loadCaches: async (ctx) => ({
    propertyDefsById: await loadPropertyDefsById(ctx, 'activity'),
    leadByEmail: new Map(),
    companyByName: new Map(),
  }),
  plan: async (ctx, row, caches, opts) => {
    try {
      const title = row.title.trim();
      if (!title) throw new Error('activity_title_required');
      if (row.ownerId && !(await ctx.db.get(row.ownerId))) throw new Error('invalid_owner');
      const email = normalizeEmail(row.contactEmail);
      const leadId = email ? (await leadOf(ctx, caches, email))._id : undefined;
      const companyName = row.companyName?.trim();
      const companyId = companyName ? (await companyOf(ctx, caches, companyName))._id : undefined;
      const customProperties = sanitizeCustomProperties(
        caches.propertyDefsById,
        row.customProperties,
      );
      const resolved: Resolved = { title, leadId, companyId, customProperties };
      const matched = opts.matchId ? await ctx.db.get(opts.matchId as Id<'activities'>) : null;
      // Without a contact there is no key to match on: the row is a new activity.
      const activity = matched ?? (leadId ? await matchActivity(ctx, leadId, row, title) : null);
      if (activity) {
        return {
          verdict: { kind: 'update', id: activity._id, label: activity.title },
          state: { kind: 'update', activity, ...resolved },
        };
      }
      return { verdict: { kind: 'create' }, state: { kind: 'create', ...resolved } };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'invalid_row';
      return { verdict: { kind: 'error', error }, state: { kind: 'error', error } };
    }
  },
  apply: async (ctx, row, state, _caches, actor) => {
    if (state.kind === 'error') return state;
    const { userId } = actor;
    if (state.kind === 'update') {
      const { activity } = state;
      const updates: Record<string, unknown> = filterUndefined({
        type: row.type,
        title: state.title,
        description: row.description?.trim(),
        dueAt: row.dueAt,
        status: row.status,
        ownerId: row.ownerId,
        companyId: state.companyId,
      });
      // Completing through the import stamps the date, as the complete action does.
      if (row.status === 'done' && activity.status !== 'done') updates.completedAt = Date.now();
      if (state.customProperties && Object.keys(state.customProperties).length) {
        updates.customProperties = { ...activity.customProperties, ...state.customProperties };
      }
      const changes = computeChanges(activity, updates);
      await ctx.db.patch(activity._id, { ...updates, ...updateAuditFields(userId) });
      if (changes) {
        await logAudit({
          ctx,
          userId,
          entityType: 'activity',
          entityId: activity._id,
          action: 'update',
          metadata: { changes, source: 'import' },
        });
      }
      return { kind: 'updated', id: activity._id };
    }
    const activityId = await createActivityRecord(
      ctx,
      {
        type: row.type,
        title: state.title,
        description: row.description,
        dueAt: row.dueAt,
        status: row.status,
        ownerId: row.ownerId ?? userId,
        leadId: state.leadId,
        companyId: state.companyId,
        customProperties: state.customProperties,
      },
      { changedBy: userId },
    );
    return { kind: 'created', id: activityId };
  },
};
