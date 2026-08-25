import { type Infer, v } from 'convex/values';

export const firstAndLastNameValidator = v.object({
  firstName: v.string(),
  lastName: v.string(),
});

export const timestampableValidator = v.object({
  updatedAt: v.number(),
});

export const blameableValidator = v.object({
  createdBy: v.optional(v.id('users')),
  updatedBy: v.optional(v.id('users')),
});

export const logsValidator = v.object({
  ...timestampableValidator.fields,
  ...blameableValidator.fields,
});

export const softDeleteValidator = v.object({
  deletedAt: v.optional(v.number()),
});

export const addressValidator = v.object({
  country: v.string(),
  streetNumber: v.string(),
  street: v.string(),
  line2: v.optional(v.string()),
  postalCode: v.string(),
  city: v.string(),
  region: v.optional(v.string()),
  placeId: v.optional(v.string()),
  coordinates: v.optional(v.object({ lat: v.number(), lng: v.number() })),
});

export type Address = Infer<typeof addressValidator>;
