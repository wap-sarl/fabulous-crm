import type { CompanyStandardField } from '@crm/lib/backend';
import { COUNTRIES } from '../../../lib/countries';
import type { FieldCatalog, StandardFieldSpec } from '../../filters/lib/advancedFilter';
import type { PropertyDefinitionRow } from '../../properties/types';

/** Built-in company columns exposed in the builder, with French label + filter type. */
export const COMPANY_FILTER_FIELDS: StandardFieldSpec<CompanyStandardField>[] = [
  { field: 'name', label: 'Nom', type: 'text' },
  { field: 'domain', label: 'Domaine', type: 'text' },
  {
    field: 'country',
    label: 'Pays',
    type: 'select',
    options: COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
  },
  { field: 'website', label: 'Site web', type: 'text' },
  { field: 'sector', label: 'Secteur', type: 'text' },
  { field: 'headcount', label: 'Effectif', type: 'number' },
  { field: 'createdAt', label: 'Date de création', type: 'timestamp' },
];

/** The company catalog for the builder: built-in columns + the company definitions. */
export function companyFieldCatalog(
  definitions: PropertyDefinitionRow[],
): FieldCatalog<CompanyStandardField> {
  return { standard: COMPANY_FILTER_FIELDS, definitions };
}
