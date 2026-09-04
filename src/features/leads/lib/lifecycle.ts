import type { LifecycleChangeSource } from '@crm/lib/backend';

/** Who or what moved a lead between statuses (lifecycleStageHistory.source). */
export const LIFECYCLE_SOURCE_LABEL: Record<LifecycleChangeSource, string> = {
  manual: 'Manuel',
  import: 'Import CSV',
  workflow: 'Workflow',
  migration: 'Migration',
  deal: 'Transaction gagnée',
  score: 'Score atteint',
  api: 'API',
};
