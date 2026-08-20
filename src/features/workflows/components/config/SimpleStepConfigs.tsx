import { useMemo } from 'react';
import {
  Combobox,
  DatePicker,
  HelperText,
  Input,
  Label,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type {
  Id,
  LeadPropertyValue,
  TrackedLinkStandardField,
  WorkflowLeadTarget,
  WorkflowNode,
  WorkflowWaitUnit,
} from '@crm/lib/backend';
import { LEAD_STATUSES } from '../../../../lib/constants';
import { useLeadLists } from '../../../leads/hooks/useLeadLists';
import type { LeadPropertyDefinitionRow } from '../../../leads/types';
import { WAIT_UNIT_LABEL } from '../../lib/constants';

type PropertyNode = Extract<WorkflowNode, { type: 'update_property' }>;
type ListNode = Extract<WorkflowNode, { type: 'add_to_list' | 'remove_from_list' }>;
type WaitNode = Extract<WorkflowNode, { type: 'wait' }>;
type WebhookNode = Extract<WorkflowNode, { type: 'webhook' }>;

/** Built-in fields a workflow may write (same exclusions as tracked links). */
const WRITABLE_STANDARD_FIELDS: { field: TrackedLinkStandardField; label: string }[] = [
  { field: 'firstName', label: 'Prénom' },
  { field: 'lastName', label: 'Nom' },
  { field: 'email', label: 'E-mail' },
  { field: 'phone', label: 'Téléphone' },
  { field: 'comment', label: 'Commentaire' },
  { field: 'status', label: 'Statut' },
  { field: 'isRedFlagged', label: 'Signalé' },
];

const encodeTarget = (t: WorkflowLeadTarget) =>
  t.kind === 'standard' ? `std:${t.field}` : `cp:${t.propertyDefId}`;

interface PropertyStepConfigProps {
  value: PropertyNode;
  onChange: (next: PropertyNode) => void;
  definitions: LeadPropertyDefinitionRow[];
}

export function PropertyStepConfig({ value, onChange, definitions }: PropertyStepConfigProps) {
  const items = useMemo(
    () => [
      ...WRITABLE_STANDARD_FIELDS.map((f) => ({ value: `std:${f.field}`, label: f.label })),
      ...definitions.map((d) => ({ value: `cp:${d._id}`, label: d.label })),
    ],
    [definitions]
  );

  const handleTargetChange = (key: string) => {
    const target: WorkflowLeadTarget = key.startsWith('cp:')
      ? { kind: 'custom', propertyDefId: key.slice(3) as Id<'leadPropertyDefinitions'> }
      : { kind: 'standard', field: key.slice(4) as TrackedLinkStandardField };
    // Reset the value to a type-appropriate default when the target changes.
    const defaultValue: LeadPropertyValue =
      target.kind === 'standard' && target.field === 'status'
        ? 'nouveau'
        : target.kind === 'standard' && target.field === 'isRedFlagged'
          ? true
          : '';
    onChange({ ...value, target, value: defaultValue });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label>Propriété à modifier</Label>
        <Combobox
          items={items}
          value={encodeTarget(value.target)}
          onValueChange={handleTargetChange}
          placeholder="Propriété"
          modal
          className="w-full"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Nouvelle valeur</Label>
        <PropertyValueInput
          target={value.target}
          value={value.value}
          definitions={definitions}
          onChange={(v) => onChange({ ...value, value: v })}
        />
      </div>
    </div>
  );
}

function PropertyValueInput({
  target,
  value,
  definitions,
  onChange,
}: {
  target: WorkflowLeadTarget;
  value: LeadPropertyValue;
  definitions: LeadPropertyDefinitionRow[];
  onChange: (v: LeadPropertyValue) => void;
}) {
  const def =
    target.kind === 'custom' ? definitions.find((d) => d._id === target.propertyDefId) : undefined;

  const booleanSelect = (
    <Select value={value === true ? 'oui' : 'non'} onValueChange={(v) => onChange(v === 'oui')}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="oui">Oui</SelectItem>
        <SelectItem value="non">Non</SelectItem>
      </SelectContent>
    </Select>
  );

  if (target.kind === 'standard') {
    if (target.field === 'status') {
      return (
        <Select
          value={typeof value === 'string' ? value : undefined}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Statut…" />
          </SelectTrigger>
          <SelectContent>
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (target.field === 'isRedFlagged') return booleanSelect;
    return (
      <Input value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
    );
  }

  if (!def) return <HelperText>Propriété introuvable ou supprimée.</HelperText>;

  const optionItems = (def.options ?? []).map((o) => ({ value: o.value, label: o.label }));
  switch (def.type) {
    case 'number':
      return (
        <Input
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <DatePicker
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v)}
        />
      );
    case 'boolean':
      return booleanSelect;
    case 'select':
    case 'radio':
      return (
        <Select
          value={typeof value === 'string' && value ? value : undefined}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choisir…" />
          </SelectTrigger>
          <SelectContent>
            {optionItems.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'checkbox':
      return (
        <MultiSelect
          items={optionItems}
          value={Array.isArray(value) ? value : []}
          onValueChange={(v) => onChange(v)}
          placeholder="Choisir…"
          modal
          className="w-full"
        />
      );
    default:
      // text / email / rpps
      return (
        <Input
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

interface ListStepConfigProps {
  value: ListNode;
  onChange: (next: ListNode) => void;
}

export function ListStepConfig({ value, onChange }: ListStepConfigProps) {
  const lists = useLeadLists();
  return (
    <div className="space-y-1.5">
      <Label>Liste</Label>
      <Select
        value={(value.listId as string | undefined) ?? undefined}
        onValueChange={(v) => onChange({ ...value, listId: v as Id<'leadLists'> })}
      >
        <SelectTrigger className="w-full" data-testid="list-step-select">
          <SelectValue placeholder="Choisir une liste…" />
        </SelectTrigger>
        <SelectContent>
          {lists.map((l) => (
            <SelectItem key={l._id} value={l._id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {lists.length === 0 ? (
        <HelperText>Aucune liste — créez-en une dans Paramètres → Listes.</HelperText>
      ) : null}
    </div>
  );
}

interface WaitStepConfigProps {
  value: WaitNode;
  onChange: (next: WaitNode) => void;
}

export function WaitStepConfig({ value, onChange }: WaitStepConfigProps) {
  return (
    <div className="space-y-1.5">
      <Label>Durée d’attente</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          className="w-24"
          value={Number.isFinite(value.amount) ? String(value.amount) : ''}
          onChange={(e) =>
            onChange({ ...value, amount: e.target.value === '' ? 0 : Number(e.target.value) })
          }
        />
        <Select
          value={value.unit}
          onValueChange={(unit) => onChange({ ...value, unit: unit as WorkflowWaitUnit })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(WAIT_UNIT_LABEL) as WorkflowWaitUnit[]).map((unit) => (
              <SelectItem key={unit} value={unit}>
                {WAIT_UNIT_LABEL[unit].plural.charAt(0).toUpperCase() +
                  WAIT_UNIT_LABEL[unit].plural.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <HelperText>Le workflow marque une pause avant l’étape suivante (max 90 jours).</HelperText>
    </div>
  );
}

interface WebhookStepConfigProps {
  value: WebhookNode;
  onChange: (next: WebhookNode) => void;
}

export function WebhookStepConfig({ value, onChange }: WebhookStepConfigProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="wf-webhook-url">URL du webhook</Label>
      <Input
        id="wf-webhook-url"
        type="url"
        value={value.url}
        onChange={(e) => onChange({ ...value, url: e.target.value })}
        placeholder="https://exemple.fr/hooks/crm"
      />
      <HelperText>
        Une requête POST (JSON) est envoyée avec les données du lead et du workflow.
      </HelperText>
    </div>
  );
}
