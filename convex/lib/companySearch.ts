import type { Doc } from '../_generated/dataModel';
import { normalizeSearchText } from './leadSearch';

/** The searchText value a company document should carry. */
export function companySearchText(
  company: Pick<Doc<'companies'>, 'name' | 'domain' | 'registrationNumber'>,
): string {
  return normalizeSearchText(
    [company.name, company.domain ?? '', company.registrationNumber ?? ''].join(' '),
  );
}
