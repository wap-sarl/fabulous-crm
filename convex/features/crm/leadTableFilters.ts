import { v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { isNotDeleted } from '../../_lib/softDelete';
import { advancedFilterListIds, leadAdvancedFilterValidator } from '../../_lib/validators/filters';
import type { LeadAdvancedFilter } from '../../_lib/validators/filters';
import type { PropertyValue } from '../../_lib/validators/properties';
import { propertyValueValidator } from '../../schema';
import { normalizeSearchText } from '../../lib/leadSearch';
import { evalAdvancedFilter, type LeadFilterExtras } from './leadMatching';

/** Filter arguments shared by the paginated table, the campaign-resolver query
 * and the batched campaign-recipient resolution. */
export const leadFilterArgs = {
  search: v.optional(v.string()),
  // Lifecycle stage keys (appConfig.lifecycle); OR within the filter.
  lifecycleStages: v.optional(v.array(v.string())),
  // Companies a lead must belong to one of (OR within the filter).
  companyIds: v.optional(v.array(v.id('companies'))),
  ownerIds: v.optional(v.array(v.id('users'))),
  isRedFlagged: v.optional(v.boolean()),
  // Custom-property filters: definitionId -> allowed values. A lead matches a
  // property if its stored value is one of the allowed (OR within a property);
  // it must match every filtered property (AND across properties). Only select
  // and boolean properties are filterable.
  customProperties: v.optional(v.record(v.string(), v.array(propertyValueValidator))),
  // Lead lists a lead must belong to at least one of (OR within the filter).
  // Membership is resolved to a Set of lead ids in the handler before matching.
  listIds: v.optional(v.array(v.id('leadLists'))),
  // Advanced group-based filter (two-level AND/OR tree of typed rules). ANDs
  // with the flat quick filters above. See convex/_lib/validators/leadFilters.ts.
  advancedFilter: v.optional(leadAdvancedFilterValidator),
} as const;

export type LeadFilters = {
  search?: string;
  lifecycleStages?: string[];
  companyIds?: Id<'companies'>[];
  ownerIds?: Id<'users'>[];
  isRedFlagged?: boolean;
  customProperties?: Record<string, PropertyValue[]>;
  listIds?: Id<'leadLists'>[];
  // Resolved membership for `listIds`, computed once per query (not a raw arg).
  listMemberIds?: Set<string>;
  advancedFilter?: LeadAdvancedFilter;
  advancedListMembers?: Map<string, Set<string>>;
};

/**
 * Resolve the set of lead ids belonging to any of `listIds` (OR semantics),
 * via the `by_list_lead` junction index. Returns undefined when no list filter
 * is active so the matcher can skip the check entirely.
 */
export async function loadListMemberIds(
  ctx: QueryCtx,
  listIds: Id<'leadLists'>[] | undefined,
): Promise<Set<string> | undefined> {
  if (!listIds || listIds.length === 0) return undefined;
  const ids = new Set<string>();
  for (const listId of listIds) {
    const members = await ctx.db
      .query('leadListMembers')
      .withIndex('by_list_lead', (q) => q.eq('listId', listId))
      .collect();
    for (const member of members) ids.add(member.leadId);
  }
  return ids;
}

/**
 * Page-scoped variant of {@link loadListMemberIds} for batched processing:
 * instead of collecting entire lists (whose size is unbounded), it point-reads
 * membership for the given leads only — bounded by page size × filtered lists.
 */
export async function loadListMemberIdsForLeads(
  ctx: QueryCtx | MutationCtx,
  listIds: Id<'leadLists'>[] | undefined,
  leadIds: Id<'leads'>[],
): Promise<Set<string> | undefined> {
  if (!listIds || listIds.length === 0) return undefined;
  const ids = new Set<string>();
  for (const leadId of leadIds) {
    for (const listId of listIds) {
      const member = await ctx.db
        .query('leadListMembers')
        .withIndex('by_list_lead', (q) => q.eq('listId', listId).eq('leadId', leadId))
        .first();
      if (member) {
        ids.add(leadId);
        break;
      }
    }
  }
  return ids;
}

export async function loadAdvancedListMembers(
  ctx: QueryCtx | MutationCtx,
  filter: LeadAdvancedFilter | undefined,
  leadIds?: Id<'leads'>[],
): Promise<Map<string, Set<string>> | undefined> {
  const listIds = advancedFilterListIds(filter) as Id<'leadLists'>[];
  if (listIds.length === 0) return undefined;
  const members = new Map<string, Set<string>>(listIds.map((id) => [id, new Set()]));
  for (const listId of listIds) {
    if (leadIds) {
      for (const leadId of leadIds) {
        const member = await ctx.db
          .query('leadListMembers')
          .withIndex('by_list_lead', (q) => q.eq('listId', listId).eq('leadId', leadId))
          .first();
        if (member) members.get(listId)?.add(leadId);
      }
    } else {
      const rows = await ctx.db
        .query('leadListMembers')
        .withIndex('by_list_lead', (q) => q.eq('listId', listId))
        .collect();
      for (const row of rows) members.get(listId)?.add(row.leadId);
    }
  }
  return members;
}

/** One lead's filter extras (list membership via indexed point reads) — for single-lead evals. */
export async function loadLeadFilterExtras(
  ctx: QueryCtx | MutationCtx,
  leadId: Id<'leads'>,
  filter: LeadAdvancedFilter | undefined,
): Promise<LeadFilterExtras> {
  const members = await loadAdvancedListMembers(ctx, filter, [leadId]);
  return { memberListIds: memberListIdsOf(members, leadId) };
}

/** One lead's `memberListIds` extras, from a resolved membership map. */
export function memberListIdsOf(
  members: Map<string, Set<string>> | undefined,
  leadId: Id<'leads'>,
): string[] | undefined {
  if (!members) return undefined;
  return [...members.entries()].filter(([, ids]) => ids.has(leadId)).map(([listId]) => listId);
}

export function matchesLeadFilters(lead: Doc<'leads'>, filters: LeadFilters): boolean {
  if (!isNotDeleted(lead)) return false;

  if (filters.lifecycleStages && filters.lifecycleStages.length > 0) {
    if (!lead.lifecycleStage || !filters.lifecycleStages.includes(lead.lifecycleStage)) {
      return false;
    }
  }

  if (filters.companyIds && filters.companyIds.length > 0) {
    if (!lead.companyId || !filters.companyIds.includes(lead.companyId)) return false;
  }

  if (filters.ownerIds && filters.ownerIds.length > 0) {
    if (!lead.ownerIds.some((id) => filters.ownerIds?.includes(id))) return false;
  }

  if (typeof filters.isRedFlagged === 'boolean') {
    if (lead.isRedFlagged !== filters.isRedFlagged) return false;
  }

  if (filters.listIds && filters.listIds.length > 0) {
    if (!filters.listMemberIds?.has(lead._id)) return false;
  }

  const search = filters.search ? normalizeSearchText(filters.search) : '';
  if (search) {
    const haystacks = [lead.firstName, lead.lastName, lead.email, lead.phone];
    const matched = haystacks.some((value) => value && normalizeSearchText(value).includes(search));
    if (!matched) return false;
  }

  if (filters.customProperties) {
    for (const [definitionId, allowed] of Object.entries(filters.customProperties)) {
      if (!allowed || allowed.length === 0) continue;
      const value = lead.customProperties?.[definitionId];
      if (value === undefined) return false;
      // checkbox values are arrays — match when the selection intersects `allowed`.
      const matched = Array.isArray(value)
        ? value.some((v) => allowed.includes(v))
        : allowed.includes(value);
      if (!matched) return false;
    }
  }

  if (
    filters.advancedFilter &&
    !evalAdvancedFilter(lead, filters.advancedFilter, {
      memberListIds: memberListIdsOf(filters.advancedListMembers, lead._id),
    })
  ) {
    return false;
  }

  return true;
}
