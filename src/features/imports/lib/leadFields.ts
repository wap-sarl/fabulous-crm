import type { LeadImportRow } from '@crm/lib/backend';
import { isValidEmail, isValidPhone } from '@crm/lib/shared';
import { addressFields, type ImportFieldDef, parseBool, parseOwners } from './fields';

export const LEAD_FIELDS_GROUP = 'Champs du lead';
export const COMPANY_GROUP = 'Entreprise';

const companyOf = (row: LeadImportRow) => {
  row.company ??= {};
  return row.company;
};

/** The columns a contact file may map to; `marketingConsent` is absent on purpose: only the person grants it. */
export const LEAD_FIELDS: readonly ImportFieldDef<LeadImportRow>[] = [
  {
    header: 'firstname',
    label: 'Prénom',
    required: true,
    aliases: ['prénom', 'prenom', 'first name', 'first_name', 'givenname'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.firstName = value as string;
    },
  },
  {
    header: 'lastname',
    label: 'Nom',
    required: true,
    aliases: ['nom', 'last name', 'last_name', 'surname', 'familyname'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.lastName = value as string;
    },
  },
  {
    header: 'email',
    label: 'E-mail',
    aliases: ['e-mail', 'courriel', 'mail', 'adresse e-mail', 'email address'],
    parse: (raw) => (isValidEmail(raw) ? { value: raw } : { error: `e-mail invalide « ${raw} »` }),
    apply: (row, value) => {
      row.email = value as string;
    },
  },
  {
    header: 'phone',
    label: 'Téléphone',
    aliases: ['téléphone', 'telephone', 'tel', 'tél', 'phone number', 'mobile', 'portable'],
    // Invalid phone numbers are dropped (left empty) rather than rejecting the row.
    parse: (raw) => (isValidPhone(raw) ? { value: raw } : { value: undefined }),
    apply: (row, value) => {
      if (value) row.phone = value as string;
    },
  },
  {
    header: 'status',
    label: 'Statut',
    aliases: ['statut', 'lifecycle stage', 'lifecyclestage', 'étape', 'stage'],
    parse: (raw, ctx) => {
      const key = ctx.lifecycleStageByName.get(raw.trim().toLowerCase());
      return key ? { value: key } : { error: `statut inconnu « ${raw} »` };
    },
    apply: (row, value) => {
      row.lifecycleStage = value as string;
    },
  },
  {
    header: 'comment',
    label: 'Commentaire',
    aliases: ['commentaire', 'notes', 'note', 'remarque'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.comment = value as string;
    },
  },
  {
    header: 'isredflagged',
    label: 'Signalé',
    aliases: ['signalé', 'signale', 'red flag', 'flag'],
    parse: (raw) => {
      const b = parseBool(raw);
      return b === undefined ? { error: `valeur booléenne invalide « ${raw} »` } : { value: b };
    },
    apply: (row, value) => {
      row.isRedFlagged = value as boolean;
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
      'contact owner',
      'responsable',
    ],
    // Employee emails separated by `;`. An empty result is left unset: the server defaults it to the importer.
    parse: (raw, ctx) => ({ value: parseOwners(raw, ctx) }),
    apply: (row, value) => {
      const ids = value as LeadImportRow['ownerIds'];
      if (ids?.length) row.ownerIds = ids;
    },
  },
  {
    header: 'company',
    label: 'Entreprise (nom)',
    group: COMPANY_GROUP,
    aliases: ['entreprise', 'société', 'societe', 'company name', 'organisation', 'organization'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      companyOf(row).name = value as string;
    },
  },
  {
    header: 'companyregistrationnumber',
    label: 'Entreprise — n° d’immatriculation (SIRET…)',
    group: COMPANY_GROUP,
    aliases: ['siret', 'siren', 'n° siret', 'registration number'],
    // Validated server-side against the company country's scheme.
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      companyOf(row).registrationNumber = value as string;
    },
  },
  {
    header: 'companyvatnumber',
    label: 'Entreprise — n° de TVA',
    group: COMPANY_GROUP,
    aliases: ['tva', 'n° tva', 'vat', 'vat number'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      companyOf(row).vatNumber = value as string;
    },
  },
  {
    header: 'companydomain',
    label: 'Entreprise — domaine',
    group: COMPANY_GROUP,
    aliases: ['domaine', 'domain', 'website', 'site web', 'company domain name'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      companyOf(row).domain = value as string;
    },
  },
  {
    header: 'companycountry',
    label: 'Entreprise — pays (code)',
    group: COMPANY_GROUP,
    aliases: ['pays entreprise', 'company country'],
    parse: (raw) => {
      const code = raw.trim().toUpperCase();
      return /^[A-Z]{2}$/.test(code) ? { value: code } : { error: `code pays invalide « ${raw} »` };
    },
    apply: (row, value) => {
      companyOf(row).country = value as string;
    },
  },
  ...addressFields<LeadImportRow>(),
];
