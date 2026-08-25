/** Consumer / free mailbox domains that never identify a company. */
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.fr',
  'outlook.com',
  'outlook.fr',
  'live.com',
  'live.fr',
  'msn.com',
  'yahoo.com',
  'yahoo.fr',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'gmx.com',
  'gmx.fr',
  'gmx.de',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'qq.com',
  '163.com',
  '126.com',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'neuf.fr',
  'laposte.net',
  'bbox.fr',
  'numericable.fr',
  'aliceadsl.fr',
  'club-internet.fr',
  'voila.fr',
  'cegetel.net',
]);

/**
 * Providers with many country TLDs (yahoo.co.uk, hotmail.de, …): matched on
 * the first label so the explicit list above stays short.
 */
const FREE_MAIL_LABELS = new Set([
  'gmail',
  'googlemail',
  'hotmail',
  'outlook',
  'live',
  'msn',
  'yahoo',
  'ymail',
  'icloud',
  'aol',
  'protonmail',
  'gmx',
  'yandex',
  'orange',
  'wanadoo',
  'free',
  'sfr',
  'laposte',
  'bbox',
]);

/** Canonical form of a domain: lowercase, no protocol, "www." or path. */
export function normalizeDomain(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let d = raw.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  d = d.split(/[/?#:]/)[0] ?? '';
  if (!d.includes('.') || /\s/.test(d)) return undefined;
  return d;
}

/** The domain part of an email address, normalized; undefined when malformed. */
export function emailDomain(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.lastIndexOf('@');
  if (at === -1) return undefined;
  return normalizeDomain(email.slice(at + 1));
}

/** RFC 2606 reserved names (documentation/testing): never a real company. */
const RESERVED_TLDS = new Set(['example', 'test', 'invalid', 'localhost']);
const RESERVED_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);

export function isFreeMailDomain(domain: string): boolean {
  if (FREE_MAIL_DOMAINS.has(domain) || RESERVED_DOMAINS.has(domain)) return true;
  const labels = domain.split('.');
  if (RESERVED_TLDS.has(labels[labels.length - 1] ?? '')) return true;
  return FREE_MAIL_LABELS.has(labels[0] ?? '');
}

/**
 * The domain a lead's email suggests as its company: undefined for missing,
 * malformed or consumer-mailbox addresses.
 */
export function companyDomainOfEmail(email: string | undefined): string | undefined {
  const domain = emailDomain(email);
  return domain && !isFreeMailDomain(domain) ? domain : undefined;
}

/** Website URL to persist for a domain-created company. */
export function websiteOfDomain(domain: string): string {
  return `https://${domain}`;
}
