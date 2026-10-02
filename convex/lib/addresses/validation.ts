import { refusal } from '../../_lib/refusal';
import { validateAddress } from '../../_lib/validators/addressFormats';

/** Throws `invalid_address: <reason>`, with the same French reason the form shows before submitting. */
export function requireValidAddress<T extends Parameters<typeof validateAddress>[0] | undefined>(
  address: T,
): T {
  if (address) {
    const error = validateAddress(address);
    if (error) throw refusal('invalid_address', { reason: error });
  }
  return address;
}
