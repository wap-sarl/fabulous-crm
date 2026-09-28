import { type Infer, v } from 'convex/values';
import { addressValidator, logsValidator, softDeleteValidator } from './shared';
import { customPropertiesValidator } from './properties';

export const companyValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,

  name: v.string(),
  // ISO-3166-1 alpha-2, uppercase: it decides which registration scheme applies and which input the forms render.
  country: v.string(),
  // Normalized by the country's scheme (digits only for a SIRET) and unique per country among live companies.
  registrationNumber: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  // Lowercase, no protocol or www ("acme.fr"), unique among live companies: a lead `x@acme.fr` attaches to this company by it.
  domain: v.optional(v.string()),
  website: v.optional(v.string()),
  sector: v.optional(v.string()),
  headcount: v.optional(v.number()),
  address: v.optional(addressValidator),

  // Maintained by the Triggers wrapper (_lib/functions.ts): never write it by hand.
  searchText: v.optional(v.string()),

  ownerIds: v.array(v.id('users')),
  customProperties: customPropertiesValidator,
});

export type Company = Infer<typeof companyValidator>;
