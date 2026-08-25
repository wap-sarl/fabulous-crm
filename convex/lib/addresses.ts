import { validateAddress } from '../_lib/validators/addressFormats';

/**
 * Country-format check of an address provided to a mutation (lead, company,
 * CSV row). Returns it unchanged, or throws `invalid_address: <reason>` —
 * the same French reason the form shows before submitting.
 */
export function requireValidAddress<T extends Parameters<typeof validateAddress>[0] | undefined>(
  address: T,
): T {
  if (address) {
    const error = validateAddress(address);
    if (error) throw new Error(`invalid_address: ${error}`);
  }
  return address;
}
