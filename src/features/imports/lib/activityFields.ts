import type { ActivityImportRow } from '@crm/lib/backend';
import { isValidEmail } from '@crm/lib/shared';
import { type ImportFieldDef, parseDateTimeCell } from './fields';

export const ACTIVITY_FIELDS_GROUP = 'Champs de l’activité';

const TYPES: Record<string, ActivityImportRow['type']> = {
  call: 'call',
  appel: 'call',
  meeting: 'meeting',
  réunion: 'meeting',
  reunion: 'meeting',
  rdv: 'meeting',
  'rendez-vous': 'meeting',
  task: 'task',
  tâche: 'task',
  tache: 'task',
  email: 'email',
  'e-mail': 'email',
  mail: 'email',
  note: 'note',
};

const STATUSES: Record<string, ActivityImportRow['status']> = {
  open: 'open',
  ouverte: 'open',
  ouvert: 'open',
  'à faire': 'open',
  'a faire': 'open',
  todo: 'open',
  done: 'done',
  terminée: 'done',
  terminee: 'done',
  terminé: 'done',
  termine: 'done',
  fait: 'done',
  faite: 'done',
  completed: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  annulée: 'cancelled',
  annulee: 'cancelled',
  annulé: 'cancelled',
};

export const ACTIVITY_FIELDS: readonly ImportFieldDef<ActivityImportRow>[] = [
  {
    header: 'type',
    label: 'Type',
    required: true,
    aliases: ['activity type', "type d'activité", 'type d’activité'],
    parse: (raw) => {
      const type = TYPES[raw.trim().toLowerCase()];
      return type
        ? { value: type }
        : { error: `type inconnu « ${raw} » (appel, réunion, tâche, e-mail, note)` };
    },
    apply: (row, value) => {
      row.type = value as ActivityImportRow['type'];
    },
  },
  {
    header: 'title',
    label: 'Titre',
    required: true,
    aliases: ['titre', 'nom', 'subject', 'sujet', 'objet', 'name'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.title = value as string;
    },
  },
  {
    header: 'description',
    label: 'Description',
    aliases: ['détail', 'detail', 'notes', 'note', 'body', 'commentaire'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.description = value as string;
    },
  },
  {
    header: 'dueat',
    label: 'Date',
    aliases: ['date', 'échéance', 'echeance', 'due date', 'due', 'date prévue', 'planifié'],
    parse: (raw) => {
      const at = parseDateTimeCell(raw);
      return at === undefined ? { error: `date invalide « ${raw} »` } : { value: at };
    },
    apply: (row, value) => {
      row.dueAt = value as number;
    },
  },
  {
    header: 'status',
    label: 'Statut',
    aliases: ['statut', 'état', 'etat', 'state'],
    parse: (raw) => {
      const status = STATUSES[raw.trim().toLowerCase()];
      return status
        ? { value: status }
        : { error: `statut inconnu « ${raw} » (à faire, terminée, annulée)` };
    },
    apply: (row, value) => {
      row.status = value as ActivityImportRow['status'];
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
    header: 'companyname',
    label: 'Entreprise (nom)',
    aliases: ['entreprise', 'société', 'societe', 'company', 'company name', 'associated company'],
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.companyName = value as string;
    },
  },
  {
    header: 'assignedto',
    label: 'Responsable',
    aliases: [
      'propriétaire',
      'proprietaire',
      'owner',
      'assigné',
      'assigne',
      'assigned to',
      'responsable',
    ],
    parse: (raw, ctx) => {
      const id = ctx.userByEmail.get(raw.trim().toLowerCase());
      return id ? { value: id } : { value: undefined };
    },
    apply: (row, value) => {
      if (value) row.ownerId = value as ActivityImportRow['ownerId'];
    },
  },
];
