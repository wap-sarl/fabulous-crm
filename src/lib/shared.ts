/**
 * Vendored shared helpers (kept dependency-free).
 */
import { isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';
import { z } from 'zod';

/** localStorage key holding the session token (kept from the original app). */
export const SESSION_TOKEN_KEY = 'wap-crm-session-token';

const emailSchema = z.email();

export function isValidEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

export const PHONE_DEFAULT_COUNTRY: CountryCode = 'FR';

export function isValidPhone(value: string): boolean {
  return isValidPhoneNumber(value, PHONE_DEFAULT_COUNTRY);
}
