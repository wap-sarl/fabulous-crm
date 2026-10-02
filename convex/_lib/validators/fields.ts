import { z } from 'zod';

/* The rules of the fields both sides check, written once: the backend refuses with them, the interface checks before sending. */

/** An e-mail address as the backend accepts one: something@something.tld, no space; the inputs of the interface ask for more (src/lib/types.ts). */
export const emailSchema = z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);

/** An address the product opens or calls: http or https, and something after it. */
export const httpUrlSchema = z.string().regex(/^https?:\/\/./);

/** `#rrggbb`, the only form of a colour the settings keep. */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** A country as its two capital letters (ISO 3166-1 alpha-2). */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

/** A currency as its three capital letters (ISO 4217). */
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

/** A whole number within bounds, as the settings keep their limits. */
export const boundedInt = (min: number, max: number) => z.number().int().min(min).max(max);

/** A whole number from 1: a number of rows, an id a provider gives, a port. */
export const positiveIntSchema = z.int().min(1);

/** A whole number from 0: a number of people. */
export const countSchema = z.int().min(0);

/** A quantity that cannot be negative: an amount, a size. */
export const nonNegativeSchema = z.number().min(0);

/** A day as `YYYY-MM-DD`. */
export const dayDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Whether a value follows a rule: the one question most callers ask. */
export const follows = (schema: z.ZodType, value: unknown): boolean =>
  schema.safeParse(value).success;
