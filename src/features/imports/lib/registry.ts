import type {
  ActivityImportRow,
  CompanyImportRow,
  DealImportRow,
  ImportEntity,
  LeadImportRow,
  PropertyEntityType,
} from '@crm/lib/backend';
import { ACTIVITY_FIELDS, ACTIVITY_FIELDS_GROUP } from './activityFields';
import { COMPANY_FIELDS, COMPANY_FIELDS_GROUP } from './companyFields';
import { DEAL_FIELDS, DEAL_FIELDS_GROUP } from './dealFields';
import type { ImportFieldDef } from './fields';
import { LEAD_FIELDS, LEAD_FIELDS_GROUP } from './leadFields';

export type ImportRowOf = {
  lead: LeadImportRow;
  company: CompanyImportRow;
  deal: DealImportRow;
  activity: ActivityImportRow;
};

export interface EntityImportSpec<E extends ImportEntity = ImportEntity> {
  entity: E;
  /** Plural, as the pages name the records. */
  label: string;
  /** « Nouveau lead » style singular for messages. */
  singular: string;
  fields: readonly ImportFieldDef<ImportRowOf[E]>[];
  mainGroup: string;
  propertyEntity: PropertyEntityType;
  /** Where to go once the import is done. */
  listPath: string;
  /** What a file of this entity looks like, for the empty state. */
  sample: string;
}

export const IMPORT_SPECS: { [E in ImportEntity]: EntityImportSpec<E> } = {
  lead: {
    entity: 'lead',
    label: 'Leads',
    singular: 'lead',
    fields: LEAD_FIELDS,
    mainGroup: LEAD_FIELDS_GROUP,
    propertyEntity: 'lead',
    listPath: '/leads',
    sample: 'Prénom;Nom;E-mail;Téléphone;Entreprise',
  },
  company: {
    entity: 'company',
    label: 'Entreprises',
    singular: 'entreprise',
    fields: COMPANY_FIELDS,
    mainGroup: COMPANY_FIELDS_GROUP,
    propertyEntity: 'company',
    listPath: '/companies',
    sample: 'Nom;Pays;SIRET;Domaine;Secteur',
  },
  deal: {
    entity: 'deal',
    label: 'Transactions',
    singular: 'transaction',
    fields: DEAL_FIELDS,
    mainGroup: DEAL_FIELDS_GROUP,
    propertyEntity: 'deal',
    listPath: '/deals',
    sample: 'Titre;Montant;Étape;E-mail du contact;Date de clôture',
  },
  activity: {
    entity: 'activity',
    label: 'Activités',
    singular: 'activité',
    fields: ACTIVITY_FIELDS,
    mainGroup: ACTIVITY_FIELDS_GROUP,
    propertyEntity: 'activity',
    listPath: '/tasks',
    sample: 'Type;Titre;Date;E-mail du contact;Statut',
  },
};

export const IMPORT_ENTITY_ORDER: ImportEntity[] = ['lead', 'company', 'deal', 'activity'];

export const isImportEntity = (value: string | null): value is ImportEntity =>
  value !== null && value in IMPORT_SPECS;
