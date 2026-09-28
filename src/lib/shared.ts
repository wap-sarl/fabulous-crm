import { isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';
import { z } from 'zod';

const emailSchema = z.email();

export function isValidEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

const PHONE_DEFAULT_COUNTRY: CountryCode = 'FR';

export function isValidPhone(value: string): boolean {
  return isValidPhoneNumber(value, PHONE_DEFAULT_COUNTRY);
}
