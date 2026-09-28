/** An empty whitelist lets every send through, which is production; an entry is an exact address, case-insensitive, or a domain wildcard (*@domain.fr). */
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

/** An empty whitelist lets every SMS through; a number matches exactly, the format is not normalised. */
export function isPhoneWhitelisted(phone: string, whitelist: string | undefined): boolean {
  if (!whitelist) return true;

  const normalized = phone.trim();
  const entries = whitelist.split(',').map((e) => e.trim());

  return entries.includes(normalized);
}
