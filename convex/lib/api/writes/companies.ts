import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import { requireValidAddress } from '../../addresses/validation';
import { logAudit } from '../../audit/log';
import { blank, normalizeIdentifiers } from '../../companies/lookup';
import { loadPropertyDefsById, sanitizeCustomProperties } from '../../properties/definitions';
import { cleanOwnerIds } from '../../users/owners';
import type { CompanyCreateBody, CompanyPatchBody } from '../bodies';
import { toPublicCompany } from '../dtos';
import {
  applyPatch,
  mergeCustomProperties,
  refs,
  requireKnownProperties,
  softDelete,
  target,
} from './common';

export async function createCompany(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  body: CompanyCreateBody,
) {
  const name = body.name.trim();
  if (!name) throw new Error('company_name_required');
  const ids = await normalizeIdentifiers(ctx, body);
  const defs = await loadPropertyDefsById(ctx, 'company');
  requireKnownProperties(defs, body.customProperties);
  const companyId = await ctx.db.insert('companies', {
    name,
    ...ids,
    website: blank(body.website),
    sector: blank(body.sector),
    headcount: body.headcount,
    address: requireValidAddress(body.address),
    ownerIds: await cleanOwnerIds(ctx, refs(ctx, 'users', body.ownerIds ?? [], 'ownerIds')),
    customProperties: sanitizeCustomProperties(defs, body.customProperties),
    updatedAt: Date.now(),
  });
  await logAudit({
    ctx,
    apiKeyId,
    entityType: 'company',
    entityId: companyId,
    action: 'create',
  });
  return toPublicCompany((await ctx.db.get(companyId))!);
}

export async function updateCompany(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  id: string,
  body: CompanyPatchBody,
) {
  const company = await target(ctx, 'companies', id);
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new Error('company_name_required');
    updates.name = name;
  }
  // Identifiers normalize together (the country picks the scheme); `null` clears one.
  const given = (value: string | null | undefined, current: string | undefined) =>
    value === null ? undefined : (value ?? current);
  if (
    body.country !== undefined ||
    body.registrationNumber !== undefined ||
    body.vatNumber !== undefined ||
    body.domain !== undefined
  ) {
    const ids = await normalizeIdentifiers(
      ctx,
      {
        country: body.country ?? company.country,
        registrationNumber: given(body.registrationNumber, company.registrationNumber),
        vatNumber: given(body.vatNumber, company.vatNumber),
        domain: given(body.domain, company.domain),
      },
      company._id,
    );
    updates.country = ids.country;
    updates.registrationNumber = ids.registrationNumber ?? null;
    updates.vatNumber = ids.vatNumber ?? null;
    updates.domain = ids.domain ?? null;
  }
  if (body.website !== undefined) updates.website = blank(body.website ?? undefined) ?? null;
  if (body.sector !== undefined) updates.sector = blank(body.sector ?? undefined) ?? null;
  if (body.headcount !== undefined) updates.headcount = body.headcount;
  if (body.address !== undefined) {
    updates.address = requireValidAddress(body.address ?? undefined) ?? null;
  }
  if (body.ownerIds !== undefined) {
    updates.ownerIds = await cleanOwnerIds(ctx, refs(ctx, 'users', body.ownerIds, 'ownerIds'));
  }
  if (body.customProperties !== undefined) {
    updates.customProperties = mergeCustomProperties(
      await loadPropertyDefsById(ctx, 'company'),
      company.customProperties,
      body.customProperties,
    );
  }

  const { real } = await applyPatch(ctx, apiKeyId, 'companies', company, updates);
  const renamed = typeof real.name === 'string' && real.name !== company.name;
  // The company name is denormalized into its leads' searchText (see updateCompany).
  if (renamed) {
    await ctx.scheduler.runAfter(
      0,
      internal.features.companies.internal.restampCompanyLeadsSearchText,
      { companyId: company._id },
    );
  }
  return toPublicCompany((await ctx.db.get(company._id))!);
}

export async function deleteCompany(ctx: MutationCtx, apiKeyId: Id<'apiKeys'>, id: string) {
  const company = await softDelete(ctx, apiKeyId, 'companies', id);
  await ctx.scheduler.runAfter(0, internal.features.companies.internal.detachCompanyLeads, {
    companyId: company._id,
  });
  return null;
}
