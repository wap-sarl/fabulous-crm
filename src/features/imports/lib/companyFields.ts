import type { CompanyImportRow } from '@crm/lib/backend';
import { numberOrUndefined } from './parseCsv';
import { addressFields, type ImportFieldDef, parseOwners } from './fields';

export const COMPANY_FIELDS_GROUP = 'Champs de l’entreprise';

const text = (
  header: string,
  key: keyof CompanyImportRow,
  label: string,
  aliases: string[],
  required = false,
): ImportFieldDef<CompanyImportRow> => ({
  header,
  label,
  required,
  aliases,
  parse: (raw) => ({ value: raw }),
  apply: (row, value) => {
    (row as Record<string, unknown>)[key] = value as string;
  },
});

export const COMPANY_FIELDS: readonly ImportFieldDef<CompanyImportRow>[] = [
  text(
    'name',
    'name',
    'Nom',
    ['nom', 'entreprise', 'société', 'societe', 'company', 'company name', 'raison sociale'],
    true,
  ),
  {
    header: 'companycountry',
    label: 'Pays (code)',
    aliases: ['pays', 'country', 'country code'],
    parse: (raw) => {
      const code = raw.trim().toUpperCase();
      return /^[A-Z]{2}$/.test(code) ? { value: code } : { error: `code pays invalide « ${raw} »` };
    },
    apply: (row, value) => {
      row.country = value as string;
    },
  },
  text('registrationnumber', 'registrationNumber', 'N° d’immatriculation (SIRET…)', [
    'siret',
    'siren',
    'n° siret',
    'registration number',
    'immatriculation',
  ]),
  text('vatnumber', 'vatNumber', 'N° de TVA', ['tva', 'n° tva', 'vat', 'vat number']),
  text('domain', 'domain', 'Domaine', [
    'domaine',
    'domain name',
    'site',
    'website',
    'site web',
    'url',
  ]),
  text('website', 'website', 'Site web', ['web']),
  text('sector', 'sector', 'Secteur', ['secteur', 'industry', 'activité', 'activite']),
  {
    header: 'headcount',
    label: 'Effectif',
    aliases: ['effectif', 'employees', 'salariés', 'salaries', 'number of employees', 'taille'],
    parse: (raw) => {
      const n = numberOrUndefined(raw);
      return n === undefined || n < 0
        ? { error: `effectif invalide « ${raw} »` }
        : { value: Math.round(n) };
    },
    apply: (row, value) => {
      row.headcount = value as number;
    },
  },
  {
    header: 'assignedto',
    label: 'Propriétaires',
    aliases: [
      'propriétaire',
      'proprietaire',
      'propriétaires',
      'owner',
      'owners',
      'company owner',
      'responsable',
    ],
    parse: (raw, ctx) => ({ value: parseOwners(raw, ctx) }),
    apply: (row, value) => {
      const ids = value as CompanyImportRow['ownerIds'];
      if (ids?.length) row.ownerIds = ids;
    },
  },
  ...addressFields<CompanyImportRow>(),
];
