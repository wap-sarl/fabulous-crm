import type { DealImportRow } from '@crm/lib/backend';
import { isValidEmail } from '@crm/lib/shared';
import { numberOrUndefined } from './parseCsv';
import { type ImportFieldDef, parseDateCell, parseOwners } from './fields';

export const DEAL_FIELDS_GROUP = 'Champs de la transaction';

export const DEAL_FIELDS: readonly ImportFieldDef<DealImportRow>[] = [
  {
    header: 'title',
    label: 'Titre',
    required: true,
    aliases: ['titre', 'nom', 'deal name', 'deal', 'name', 'intitulé', 'intitule', 'affaire'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.title = value as string;
    },
  },
  {
    header: 'amount',
    label: 'Montant',
    aliases: ['montant', 'valeur', 'value', 'deal amount', 'prix'],
    parse: (raw) => {
      const n = numberOrUndefined(raw.replace(/[€$£]/g, ''));
      return n === undefined || n < 0 ? { error: `montant invalide « ${raw} »` } : { value: n };
    },
    apply: (row, value) => {
      row.amount = value as number;
    },
  },
  {
    header: 'currency',
    label: 'Devise',
    aliases: ['devise', 'monnaie'],
    parse: (raw) => {
      const code = raw.trim().toUpperCase();
      return /^[A-Z]{3}$/.test(code) ? { value: code } : { error: `devise invalide « ${raw} »` };
    },
    apply: (row, value) => {
      row.currency = value as string;
    },
  },
  {
    header: 'expectedclosedate',
    label: 'Date de clôture prévue',
    aliases: ['clôture', 'cloture', 'close date', 'date de clôture', 'échéance', 'echeance'],
    parse: (raw) => {
      const date = parseDateCell(raw);
      return date ? { value: date } : { error: `date invalide « ${raw} »` };
    },
    apply: (row, value) => {
      row.expectedCloseDate = value as string;
    },
  },
  {
    header: 'pipeline',
    label: 'Pipeline (nom)',
    aliases: ['pipeline name'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.pipeline = value as string;
    },
  },
  {
    header: 'stage',
    label: 'Étape',
    aliases: ['étape', 'etape', 'deal stage', 'statut', 'status'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.stage = value as string;
    },
  },
  {
    header: 'contactemail',
    label: 'Contact (e-mail)',
    aliases: ['email', 'e-mail', 'contact', 'lead', 'associated contact', 'e-mail du contact'],
    parse: (raw) => (isValidEmail(raw) ? { value: raw } : { error: `e-mail invalide « ${raw} »` }),
    apply: (row, value) => {
      row.contactEmail = value as string;
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
      'deal owner',
      'responsable',
    ],
    parse: (raw, ctx) => ({ value: parseOwners(raw, ctx) }),
    apply: (row, value) => {
      const ids = value as DealImportRow['ownerIds'];
      if (ids?.length) row.ownerIds = ids;
    },
  },
];
