import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { employeeMutation } from '../../_lib/auth';
import { addressValidator } from '../../schema';
import { propertyValueValidator } from '../../_lib/validators/properties';
import { cleanOwnerIds } from '../../lib/owners';
import { loadPropertyDefsById, sanitizeCustomProperties } from '../../lib/properties';
import {
  computeChanges,
  createAuditFields,
  filterUndefined,
  logAudit,
  updateAuditFields,
} from '../../lib';
import { blank, normalizeIdentifiers } from '../../lib/companies';
import { requireValidAddress } from '../../lib/addresses';

const companyFieldArgs = {
  name: v.string(),
  country: v.optional(v.string()),
  registrationNumber: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  domain: v.optional(v.string()),
  website: v.optional(v.string()),
  sector: v.optional(v.string()),
  headcount: v.optional(v.number()),
  address: v.optional(addressValidator),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
  ownerIds: v.optional(v.array(v.id('users'))),
} as const;

export const createCompany = employeeMutation({
  args: companyFieldArgs,
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error('company_name_required');
    const ids = await normalizeIdentifiers(ctx, args);

    const companyId = await ctx.db.insert('companies', {
      name,
      ...ids,
      website: blank(args.website),
      sector: blank(args.sector),
      headcount: args.headcount,
      address: requireValidAddress(args.address),
      ownerIds: await cleanOwnerIds(ctx, args.ownerIds ?? []),
      customProperties: sanitizeCustomProperties(
        await loadPropertyDefsById(ctx, 'company'),
        args.customProperties,
      ),
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'company',
      entityId: companyId,
      action: 'create',
    });
    return companyId;
  },
});

export const updateCompany = employeeMutation({
  args: {
    companyId: v.id('companies'),
    ...companyFieldArgs,
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { companyId, ...rest } = args;
    const company = await ctx.db.get(companyId);
    if (!company || company.deletedAt != null) throw new Error('company_not_found');

    const updates: Record<string, unknown> = {};
    if (rest.name !== undefined) {
      const name = rest.name.trim();
      if (!name) throw new Error('company_name_required');
      updates.name = name;
    }
    // Identifiers are normalized together: the country decides the scheme
    // the registration number is validated against.
    if (
      rest.country !== undefined ||
      rest.registrationNumber !== undefined ||
      rest.vatNumber !== undefined ||
      rest.domain !== undefined
    ) {
      const ids = await normalizeIdentifiers(
        ctx,
        {
          country: rest.country ?? company.country,
          registrationNumber: rest.registrationNumber ?? company.registrationNumber,
          vatNumber: rest.vatNumber ?? company.vatNumber,
          domain: rest.domain ?? company.domain,
        },
        companyId,
      );
      updates.country = ids.country;
      // An explicitly blank value clears the field (patching undefined removes it).
      updates.registrationNumber = ids.registrationNumber;
      updates.vatNumber = ids.vatNumber;
      updates.domain = ids.domain;
    }
    if (rest.website !== undefined) updates.website = blank(rest.website);
    if (rest.sector !== undefined) updates.sector = blank(rest.sector);
    if (rest.headcount !== undefined) updates.headcount = rest.headcount;
    if (rest.address !== undefined) updates.address = requireValidAddress(rest.address);
    if (rest.ownerIds !== undefined) updates.ownerIds = await cleanOwnerIds(ctx, rest.ownerIds);
    if (rest.customProperties !== undefined) {
      updates.customProperties = sanitizeCustomProperties(
        await loadPropertyDefsById(ctx, 'company'),
        rest.customProperties,
      );
    }

    const changes = computeChanges(company, filterUndefined(updates));
    const renamed = typeof updates.name === 'string' && updates.name !== company.name;
    await ctx.db.patch(companyId, { ...updates, ...updateAuditFields(ctx.userId) });

    if (changes || renamed) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'company',
        entityId: companyId,
        action: 'update',
        metadata: { changes },
      });
    }
    // The company name is denormalized into its leads' searchText: re-stamp
    // them in scheduled batches (a company can have thousands of contacts).
    if (renamed) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.companies.internal.restampCompanyLeadsSearchText,
        { companyId },
      );
    }
    return companyId;
  },
});

/**
 * Soft-delete a company. Its contacts stay (they are people, not the
 * company's property) and are detached in scheduled batches.
 */
export const deleteCompany = employeeMutation({
  args: { companyId: v.id('companies') },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company || company.deletedAt != null) throw new Error('company_not_found');
    await ctx.db.patch(args.companyId, {
      deletedAt: Date.now(),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'company',
      entityId: args.companyId,
      action: 'delete',
    });
    await ctx.scheduler.runAfter(0, internal.features.companies.internal.detachCompanyLeads, {
      companyId: args.companyId,
    });
  },
});
