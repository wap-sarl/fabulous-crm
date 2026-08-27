import { type Infer, v } from 'convex/values';
import { addressValidator, logsValidator, softDeleteValidator } from './shared';
import { customPropertiesValidator } from './properties';

export const companyValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,

  name: v.string(),
  // ISO-3166-1 alpha-2, uppercase (e.g. 'FR'). Drives which registration
  // scheme applies and which input the forms render.
  country: v.string(),
  // National business identifier, normalized by the country's scheme (digits
  // only for a SIRET). Unique per country among live companies.
  registrationNumber: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  // Web domain, lowercase, no protocol/www ("acme.fr"). The automatic
  // lead-matching key: a lead `x@acme.fr` attaches to this company. Unique
  // among live companies.
  domain: v.optional(v.string()),
  website: v.optional(v.string()),
  sector: v.optional(v.string()),
  headcount: v.optional(v.number()),
  address: v.optional(addressValidator),

  // Denormalized search text (name, domain, registration number), maintained
  // by the Triggers wrapper (_lib/functions.ts) — never written by hand.
  searchText: v.optional(v.string()),

  customProperties: customPropertiesValidator,
});

export type Company = Infer<typeof companyValidator>;
