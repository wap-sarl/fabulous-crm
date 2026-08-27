import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  normalizeCountryCode,
  registrationSchemeFor,
  vatSchemeFor,
} from '../_lib/validators/companyRegistry';
import { createAuditFields } from './audit';
import { companyDomainOfEmail, normalizeDomain, websiteOfDomain } from './companyDomains';
import { isNotDeleted } from './dbHelpers';
import { logAudit } from './audit';

/** Live company by (country, registration number), or null. */
export async function findCompanyByRegistration(
  ctx: QueryCtx | MutationCtx,
  country: string,
  registrationNumber: string,
): Promise<Doc<'companies'> | null> {
  const company = await ctx.db
    .query('companies')
    .withIndex('by_country_registrationNumber', (q) =>
      q.eq('country', country).eq('registrationNumber', registrationNumber),
    )
    .first();
  return company && isNotDeleted(company) ? company : null;
}

/** Assert a live company exists — an explicit pick that no longer exists is a form bug. */
export async function requireCompany(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<'companies'>,
): Promise<void> {
  const company = await ctx.db.get(companyId);
  if (!company || company.deletedAt != null) throw new Error('company_not_found');
}

/** Live company by normalized VAT number, or null. */
export async function findCompanyByVat(
  ctx: QueryCtx | MutationCtx,
  vatNumber: string,
): Promise<Doc<'companies'> | null> {
  const company = await ctx.db
    .query('companies')
    .withIndex('by_vatNumber', (q) => q.eq('vatNumber', vatNumber))
    .first();
  return company && isNotDeleted(company) ? company : null;
}

/**
 * Normalize + validate a VAT number for `country`. Throws
 * `invalid_vat_number: <reason>`.
 */
export function normalizeVatNumber(country: string, raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const scheme = vatSchemeFor(country);
  const normalized = scheme.normalize(raw);
  if (!normalized) return undefined;
  const error = scheme.validate(normalized, country);
  if (error) throw new Error(`invalid_vat_number: ${error}`);
  return normalized;
}

/** Live company by normalized domain, or null. */
export async function findCompanyByDomain(
  ctx: QueryCtx | MutationCtx,
  domain: string,
): Promise<Doc<'companies'> | null> {
  const company = await ctx.db
    .query('companies')
    .withIndex('by_domain', (q) => q.eq('domain', domain))
    .first();
  return company && isNotDeleted(company) ? company : null;
}

/**
 * Normalize + validate a registration number for `country` through the scheme
 * registry. Throws `invalid_registration_number: <reason>` — a form bug or a
 * bad CSV cell, surfaced as-is.
 */
export function normalizeRegistrationNumber(
  country: string,
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  const scheme = registrationSchemeFor(country);
  const normalized = scheme.normalize(raw);
  if (!normalized) return undefined;
  const error = scheme.validate(normalized);
  if (error) throw new Error(`invalid_registration_number: ${error}`);
  return normalized;
}

export type CompanyHint = {
  name?: string;
  country?: string;
  registrationNumber?: string;
  vatNumber?: string;
  domain?: string;
};

export async function resolveCompanyForLead(
  ctx: MutationCtx,
  hint: CompanyHint,
  email: string | undefined,
  userId: Id<'users'>,
  cache?: Map<string, Id<'companies'>>,
): Promise<Id<'companies'> | null> {
  const country = normalizeCountryCode(hint.country);
  const registrationNumber = normalizeRegistrationNumber(country, hint.registrationNumber);
  const vatNumber = normalizeVatNumber(country, hint.vatNumber);
  const domain = normalizeDomain(hint.domain) ?? companyDomainOfEmail(email);
  const name = hint.name?.trim();

  const cacheKey = registrationNumber
    ? `reg:${country}:${registrationNumber}`
    : vatNumber
      ? `vat:${vatNumber}`
      : domain
        ? `dom:${domain}`
        : null;
  if (cacheKey && cache?.has(cacheKey)) return cache.get(cacheKey)!;

  let found: Doc<'companies'> | null = null;
  if (registrationNumber) found = await findCompanyByRegistration(ctx, country, registrationNumber);
  if (!found && vatNumber) found = await findCompanyByVat(ctx, vatNumber);
  if (!found && domain) found = await findCompanyByDomain(ctx, domain);
  if (found) {
    if (cacheKey) cache?.set(cacheKey, found._id);
    return found._id;
  }

  if (!name) return null;

  const companyId = await ctx.db.insert('companies', {
    name,
    country,
    registrationNumber,
    vatNumber,
    domain,
    website: domain ? websiteOfDomain(domain) : undefined,
    ownerIds: [],
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
  if (cacheKey) cache?.set(cacheKey, companyId);
  return companyId;
}
