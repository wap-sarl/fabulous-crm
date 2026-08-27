import type { DealStandardField, Doc } from '@crm/lib/backend';
import { CURRENCIES, DEAL_STATUSES } from '../../../lib/constants';
import type { FieldCatalog, StandardFieldSpec } from '../../filters/lib/advancedFilter';
import type { PropertyDefinitionRow } from '../../properties/types';

/**
 * Built-in deal columns exposed in the builder. Stages come from the live
 * pipelines: one option per stage, prefixed by the pipeline name when several exist.
 */
export function dealFilterFields(
  pipelines: Doc<'pipelines'>[],
): StandardFieldSpec<DealStandardField>[] {
  const stages = pipelines.flatMap((p) =>
    p.stages.map((s) => ({
      value: s.key,
      label: pipelines.length > 1 ? `${p.name} · ${s.label}` : s.label,
    })),
  );
  return [
    { field: 'title', label: 'Intitulé', type: 'text' },
    { field: 'amount', label: 'Montant', type: 'number' },
    {
      field: 'currency',
      label: 'Devise',
      type: 'select',
      options: CURRENCIES.map((c) => ({ value: c, label: c })),
    },
    {
      field: 'status',
      label: 'Statut',
      type: 'select',
      options: DEAL_STATUSES.map((s) => ({ value: s.value, label: s.label })),
    },
    { field: 'stageKey', label: 'Stade', type: 'select', options: stages },
    { field: 'ownerIds', label: 'Propriétaires', type: 'assignee' },
    { field: 'expectedCloseDate', label: 'Clôture prévue', type: 'date' },
  ];
}

/** The deal catalog for the builder: built-in columns + the deal definitions. */
export function dealFieldCatalog(
  pipelines: Doc<'pipelines'>[],
  definitions: PropertyDefinitionRow[],
): FieldCatalog<DealStandardField> {
  return { standard: dealFilterFields(pipelines), definitions };
}
