import type { FormattableAddress } from '@crm/lib/backend';
import { formatAddressOneLine } from '@crm/lib/backend';
import { countryName } from './countries';

/** One-line address in the country's postal order, with the French country name. */
export function formatAddress(address: FormattableAddress | undefined): string {
  return formatAddressOneLine(address, countryName);
}
