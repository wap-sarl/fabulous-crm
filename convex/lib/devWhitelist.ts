/**
 * Dev whitelist for email and SMS sending.
 *
 * When the whitelist string is undefined or empty,
 * all sends go through (production behavior).
 * When set, only matching recipients are allowed; others are blocked.
 */

/**
 * Checks if an email is allowed to receive messages.
 * Supports exact matches (case-insensitive) and domain wildcards (*@domain.fr).
 *
 * @param email - The email address to check.
 * @param whitelist - Comma-separated list of allowed emails/domains (from env var).
 */
export function isEmailWhitelisted(email: string, whitelist: string | undefined): boolean {
  if (!whitelist) return true;

  const normalized = email.toLowerCase().trim();
  const entries = whitelist.split(',').map((e) => e.trim().toLowerCase());

  return entries.some((entry) => {
    if (entry.startsWith('*@')) {
      const domain = entry.slice(2);
      return normalized.endsWith(`@${domain}`);
    }
    return normalized === entry;
  });
}

/**
 * Checks if a phone number is allowed to receive SMS.
 * Exact match only (after trimming whitespace).
 *
 * @param phone - The phone number to check.
 * @param whitelist - Comma-separated list of allowed phone numbers (from env var).
 */
export function isPhoneWhitelisted(phone: string, whitelist: string | undefined): boolean {
  if (!whitelist) return true;

  const normalized = phone.trim();
  const entries = whitelist.split(',').map((e) => e.trim());

  return entries.includes(normalized);
}
