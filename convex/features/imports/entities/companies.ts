import { internal } from '../../../_generated/api';
import type { Doc, Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import { normalizeCountryCode } from '../../../_lib/validators/companyRegistry';
import type { CompanyImportRow } from '../../../_lib/validators/imports';
import type { PropertyValue } from '../../../_lib/validators/properties';
import { requireValidAddress } from '../../../lib/addresses';
import { computeChanges, createAuditFields, logAudit, updateAuditFields } from '../../../lib/audit';
import {
  blank,
  findCompanyByDomain,
  findCompanyByRegistration,
  findCompanyByVat,
  normalizeIdentifiers,
  normalizeRegistrationNumber,
  normalizeVatNumber,
} from '../../../lib/companies';
import { normalizeDomain } from '../../../lib/companyDomains';
import { filterUndefined, isNotDeleted } from '../../../lib/dbHelpers';
import { cleanOwnerIds } from '../../../lib/owners';
import {
  loadPropertyDefsById,
  type PropertyDefinitionDoc,
  sanitizeCustomProperties,
} from '../../../lib/properties';
import type { EntityImporter } from './types';

interface Caches {
  propertyDefsById: Map<string, PropertyDefinitionDoc>;
}

type Identifiers = Awaited<ReturnType<typeof normalizeIdentifiers>>;

type State =
  | { kind: 'error'; error: string }
  | {
      kind: 'create';
      name: string;
      ids: Identifiers;
      customProperties?: Record<string, PropertyValue>;
    }
  | {
      kind: 'update';
      company: Doc<'companies'>;
      name: string;
      ids: Identifiers;
      customProperties?: Record<string, PropertyValue>;
    };

/** A live company with exactly this name: the last resort of the match, so a file imported twice does not double them. */
async function findCompanyByName(ctx: MutationCtx, name: string): Promise<Doc<'companies'> | null> {
  const rows = await ctx.db
    .query('companies')
    .withIndex('by_name', (q) => q.eq('name', name))
    .take(20);
  return rows.find(isNotDeleted) ?? null;
}

/** The company a row updates: by registration number, VAT number, domain, then exact name. */
async function matchCompany(
  ctx: MutationCtx,
  row: CompanyImportRow,
  name: string,
): Promise<Doc<'companies'> | null> {
  const country = normalizeCountryCode(row.country);
  // The same normalization the create path applies, so "552 100 554 00013" finds "55210055400013"; an invalid
  // number is the create path's error, not a match.
  const registration = tryNormalize(() =>
    normalizeRegistrationNumber(country, blank(row.registrationNumber)),
  );
  if (registration) {
    const found = await findCompanyByRegistration(ctx, country, registration);
    if (found) return found;
  }
  const vat = tryNormalize(() => normalizeVatNumber(country, blank(row.vatNumber)));
  if (vat) {
    const found = await findCompanyByVat(ctx, vat);
    if (found) return found;
  }
  const domain = normalizeDomain(row.domain);
  if (domain) {
    const found = await findCompanyByDomain(ctx, domain);
    if (found) return found;
  }
  return await findCompanyByName(ctx, name);
}

const tryNormalize = (fn: () => string | undefined): string | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

export const companyImporter: EntityImporter<CompanyImportRow, Caches, State> = {
  loadCaches: async (ctx) => ({ propertyDefsById: await loadPropertyDefsById(ctx, 'company') }),
  plan: async (ctx, row, caches, opts) => {
    const name = row.name.trim();
    if (!name)
      return {
        verdict: { kind: 'error', error: 'company_name_required' },
        state: { kind: 'error', error: 'company_name_required' },
      };
    try {
      requireValidAddress(row.address);
      const customProperties = sanitizeCustomProperties(
        caches.propertyDefsById,
        row.customProperties,
      );
      const matched = opts.matchId ? await ctx.db.get(opts.matchId as Id<'companies'>) : null;
      const company = matched ?? (await matchCompany(ctx, row, name));
      if (company) {
        // Identifiers are normalized together: the country decides the scheme; a clash with another company is a row error.
        const ids = await normalizeIdentifiers(
          ctx,
          {
            country: row.country ?? company.country,
            registrationNumber: row.registrationNumber ?? company.registrationNumber,
            vatNumber: row.vatNumber ?? company.vatNumber,
            domain: row.domain ?? company.domain,
          },
          company._id,
        );
        return {
          verdict: { kind: 'update', id: company._id, label: company.name },
          state: { kind: 'update', company, name, ids, customProperties },
        };
      }
      const ids = await normalizeIdentifiers(ctx, row);
      return {
        verdict: { kind: 'create' },
        state: { kind: 'create', name, ids, customProperties },
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'invalid_row';
      return { verdict: { kind: 'error', error }, state: { kind: 'error', error } };
    }
  },
  apply: async (ctx, row, state, _caches, actor) => {
    if (state.kind === 'error') return state;
    const { userId } = actor;
    if (state.kind === 'update') {
      const { company, ids } = state;
      const updates: Record<string, unknown> = filterUndefined({
        name: state.name,
        country: ids.country,
        registrationNumber:
          row.registrationNumber === undefined ? undefined : ids.registrationNumber,
        vatNumber: row.vatNumber === undefined ? undefined : ids.vatNumber,
        domain: row.domain === undefined ? undefined : ids.domain,
        website: row.website === undefined ? undefined : blank(row.website),
        sector: row.sector === undefined ? undefined : blank(row.sector),
        headcount: row.headcount,
        address: row.address,
        ownerIds: row.ownerIds ? await cleanOwnerIds(ctx, row.ownerIds) : undefined,
      });
      if (state.customProperties && Object.keys(state.customProperties).length) {
        updates.customProperties = { ...company.customProperties, ...state.customProperties };
      }
      const changes = computeChanges(company, updates);
      const revived = company.deletedAt != null;
      const patch: Record<string, unknown> = { ...updates, ...updateAuditFields(userId) };
      if (revived) patch.deletedAt = undefined;
      await ctx.db.patch(company._id, patch);
      if (changes || revived) {
        await logAudit({
          ctx,
          userId,
          entityType: 'company',
          entityId: company._id,
          action: 'update',
          metadata: { changes, source: 'import', ...(revived ? { revived: true } : {}) },
        });
      }
      // The company name is denormalized into its leads' searchText: re-stamp them in scheduled batches.
      if (state.name !== company.name) {
        await ctx.scheduler.runAfter(
          0,
          internal.features.companies.internal.restampCompanyLeadsSearchText,
          { companyId: company._id },
        );
      }
      return { kind: 'updated', id: company._id };
    }
    const companyId = await ctx.db.insert('companies', {
      name: state.name,
      ...state.ids,
      website: blank(row.website),
      sector: blank(row.sector),
      headcount: row.headcount,
      address: row.address,
      ownerIds: await cleanOwnerIds(ctx, row.ownerIds ?? []),
      customProperties: state.customProperties,
      ...createAuditFields(userId),
    });
    await logAudit({
      ctx,
      userId,
      entityType: 'company',
      entityId: companyId,
      action: 'create',
      metadata: { source: 'import' },
    });
    return { kind: 'created', id: companyId };
  },
};
