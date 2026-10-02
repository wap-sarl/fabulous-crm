import type { ImportJobStatus, ImportRowOutcome } from '@crm/lib/backend';
import type { StatusTone } from '@crm/design-system';

export const JOB_STATUS_LABEL: Record<ImportJobStatus, string> = {
  uploading: 'Envoi',
  simulating: 'Simulation',
  simulated: 'Simulé',
  running: 'En cours',
  interrupted: 'Interrompu',
  done: 'Terminé',
  cancelled: 'Annulé',
};

export const JOB_STATUS_TONE: Record<ImportJobStatus, StatusTone> = {
  uploading: 'gray',
  simulating: 'blue',
  simulated: 'violet',
  running: 'blue',
  interrupted: 'red',
  done: 'green',
  cancelled: 'gray',
};

export const OUTCOME_LABEL: Record<ImportRowOutcome, string> = {
  create: 'À créer',
  update: 'À mettre à jour',
  duplicate: 'Doublon probable',
  created: 'Créé',
  updated: 'Mis à jour',
  error: 'En erreur',
};
