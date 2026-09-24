import type { Id } from '../../../_generated/dataModel';
import type { LeadImportRow } from '../../../_lib/validators/imports';
import { gateLeadCreate } from '../../../lib/gates';
import {
  applyLeadImport,
  type LeadImportCaches,
  type LeadImportPlan,
  leadLabel,
  loadLeadImportCaches,
  planLeadImport,
} from '../../../lib/leadImport';
import type { EntityImporter } from './types';

/** Contacts: the upsert of lib/leadImport.ts, matched by email, with the probable duplicates of the duplicate module. */
export const leadImporter: EntityImporter<LeadImportRow, LeadImportCaches, LeadImportPlan> = {
  loadCaches: loadLeadImportCaches,
  gate: (ctx, count) => gateLeadCreate(ctx, count, 'import'),
  plan: async (ctx, row, caches, opts) => {
    const plan = await planLeadImport(ctx, row, caches, {
      matchId: opts.matchId as Id<'leads'> | undefined,
      detectDuplicates: opts.detectDuplicates,
    });
    switch (plan.kind) {
      case 'error':
        return { verdict: plan, state: plan };
      case 'create':
        return { verdict: { kind: 'create' }, state: plan };
      case 'update':
        return {
          verdict: { kind: 'update', id: plan.lead._id, label: leadLabel(plan.lead) },
          state: plan,
        };
      case 'duplicate':
        return {
          verdict: {
            kind: 'duplicate',
            id: plan.lead._id,
            label: leadLabel(plan.lead),
            reasons: plan.reasons,
          },
          state: plan,
        };
    }
  },
  apply: async (ctx, row, state, caches, actor) => {
    if (state.kind === 'error') return state;
    const result = await applyLeadImport(ctx, row, state, caches, actor);
    return result.kind === 'error' ? result : { kind: result.kind, id: result.leadId };
  },
};
