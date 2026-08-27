/**
 * Vendored shared types.
 */
import { z } from 'zod';

export const EMAIL_ERROR_MESSAGES = {
  empty: 'Veuillez entrer votre adresse email',
  invalid: 'Veuillez entrer une adresse email valide',
} as const;

export const zEmailSchema = z
  .string({ error: EMAIL_ERROR_MESSAGES.empty })
  .min(1, EMAIL_ERROR_MESSAGES.empty)
  .pipe(z.email({ error: EMAIL_ERROR_MESSAGES.invalid }));

export const zOptionalEmailSchema = zEmailSchema.or(z.literal(''));

export type EmailErrorMessages = typeof EMAIL_ERROR_MESSAGES;

/** Normalized user returned by session validation. */
export type SessionUser = {
  _id: string;
  email: string;
  type: 'employee';
  role: 'admin' | 'manager' | 'member';
  name: string;
};
