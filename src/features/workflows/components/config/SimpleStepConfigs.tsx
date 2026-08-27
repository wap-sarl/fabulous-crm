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
import { useLeadLists } from '../../../leads/hooks/useLeadLists';
import { useLifecycleConfig } from '../../../leads/hooks/useLifecycleConfig';
import { usePipelines } from '../../../deals/hooks/usePipelines';
import { ACTIVITY_TYPES, CURRENCIES } from '../../../../lib/constants';
import { useEmployees } from '../../../../lib/hooks/useEmployees';
import type { LeadPropertyDefinitionRow } from '../../../leads/types';
import { WAIT_UNIT_LABEL } from '../../lib/constants';

type PropertyNode = Extract<WorkflowNode, { type: 'update_property' }>;
type ListNode = Extract<WorkflowNode, { type: 'add_to_list' | 'remove_from_list' }>;
type LifecycleNode = Extract<WorkflowNode, { type: 'set_lifecycle_stage' }>;
type CreateDealNode = Extract<WorkflowNode, { type: 'create_deal' }>;
type DealStageNode = Extract<WorkflowNode, { type: 'update_deal_stage' }>;
type CreateTaskNode = Extract<WorkflowNode, { type: 'create_task' }>;
type WaitNode = Extract<WorkflowNode, { type: 'wait' }>;
type WebhookNode = Extract<WorkflowNode, { type: 'webhook' }>;

/** Built-in fields a workflow may write (same exclusions as tracked links). */
const WRITABLE_STANDARD_FIELDS: { field: TrackedLinkStandardField; label: string }[] = [
  { field: 'firstName', label: 'Prénom' },
  { field: 'lastName', label: 'Nom' },
  { field: 'email', label: 'E-mail' },
  { field: 'phone', label: 'Téléphone' },
  { field: 'comment', label: 'Commentaire' },
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
    [definitions],
  );

  const handleTargetChange = (key: string) => {
    const target: WorkflowLeadTarget = key.startsWith('cp:')
      ? { kind: 'custom', propertyDefId: key.slice(3) as Id<'leadPropertyDefinitions'> }
      : { kind: 'standard', field: key.slice(4) as TrackedLinkStandardField };
    // Reset the value to a type-appropriate default when the target changes.
    const defaultValue: LeadPropertyValue =
      target.kind === 'standard' && target.field === 'isRedFlagged' ? true : '';
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
    if (target.field === 'isRedFlagged') return booleanSelect;
    return (
      <Input
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
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

interface LifecycleStepConfigProps {
  value: LifecycleNode;
  onChange: (next: LifecycleNode) => void;
}

export function LifecycleStepConfig({ value, onChange }: LifecycleStepConfigProps) {
  const lifecycle = useLifecycleConfig();
  return (
    <div className="space-y-1.5">
      <Label>Statut</Label>
      <Select
        value={value.stage ?? undefined}
        onValueChange={(v) => onChange({ ...value, stage: v })}
      >
        <SelectTrigger className="w-full" data-testid="lifecycle-step-select">
          <SelectValue placeholder="Choisir un statut…" />
        </SelectTrigger>
        <SelectContent>
          {lifecycle.stages.map((s) => (
            <SelectItem key={s.key} value={s.key}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <HelperText>
        {lifecycle.allowRegression
          ? 'Le lead passe à ce statut, même s’il précède le statut actuel.'
          : 'Le lead passe à ce statut ; un retour en arrière est ignoré (Paramètres → Statuts).'}
      </HelperText>
    </div>
  );
}

const ANY_PIPELINE = '__default__';

/** Pipeline + stage pair used by both deal steps. */
function PipelineStageFields({
  pipelineId,
  stageKey,
  onChange,
  pipelineHelper,
  stageRequired,
}: {
  pipelineId: Id<'pipelines'> | undefined;
  stageKey: string | undefined;
  onChange: (next: { pipelineId?: Id<'pipelines'>; stageKey?: string }) => void;
  pipelineHelper: string;
  stageRequired: boolean;
}) {
  const { pipelines, byId, defaultPipeline } = usePipelines();
  const pipeline = (pipelineId ? byId.get(pipelineId) : undefined) ?? defaultPipeline;
  return (
    <>
      <div className="space-y-1.5">
        <Label>Pipeline</Label>
        <Select
          value={(pipelineId as string | undefined) ?? ANY_PIPELINE}
          onValueChange={(v) =>
            onChange({
              pipelineId: v === ANY_PIPELINE ? undefined : (v as Id<'pipelines'>),
              stageKey: undefined,
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_PIPELINE}>Pipeline par défaut</SelectItem>
            {pipelines.map((p) => (
              <SelectItem key={p._id} value={p._id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <HelperText>{pipelineHelper}</HelperText>
      </div>
      <div className="space-y-1.5">
        <Label>Stade{stageRequired ? '' : ' (optionnel)'}</Label>
        <Select
          value={stageKey ?? (stageRequired ? undefined : '__first__')}
          onValueChange={(v) =>
            onChange({ pipelineId, stageKey: v === '__first__' ? undefined : v })
          }
        >
          <SelectTrigger className="w-full" data-testid="deal-stage-select">
            <SelectValue placeholder="Choisir un stade…" />
          </SelectTrigger>
          <SelectContent>
            {!stageRequired ? (
              <SelectItem value="__first__">Premier stade ouvert</SelectItem>
            ) : null}
            {(pipeline?.stages ?? []).map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

export function CreateDealStepConfig({
  value,
  onChange,
}: {
  value: CreateDealNode;
  onChange: (next: CreateDealNode) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="wf-deal-title">Intitulé de la transaction</Label>
        <Input
          id="wf-deal-title"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="Transaction {{ params.firstName }} {{ params.lastName }}"
        />
        <HelperText>Les {'{{ params.x }}'} du lead sont remplacés à la création.</HelperText>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="wf-deal-amount">Montant (optionnel)</Label>
          <Input
            id="wf-deal-amount"
            type="number"
            min={0}
            value={value.amount !== undefined ? String(value.amount) : ''}
            onChange={(e) =>
              onChange({
                ...value,
                amount: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </div>
        <Select
          value={value.currency ?? 'EUR'}
          onValueChange={(currency) => onChange({ ...value, currency })}
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <PipelineStageFields
        pipelineId={value.pipelineId}
        stageKey={value.stageKey}
        onChange={(next) => onChange({ ...value, ...next })}
        pipelineHelper="La transaction est créée pour le lead, son entreprise et son responsable."
        stageRequired={false}
      />
    </div>
  );
}

const LEAD_OWNER = '__lead_owner__';

export function CreateTaskStepConfig({
  value,
  onChange,
}: {
  value: CreateTaskNode;
  onChange: (next: CreateTaskNode) => void;
}) {
  const { employees } = useEmployees();
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label>Type</Label>
        <Select
          value={value.activityType ?? 'task'}
          onValueChange={(v) =>
            onChange({ ...value, activityType: v as CreateTaskNode['activityType'] })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_TYPES.filter((t) => t.value !== 'note').map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wf-task-title">Intitulé</Label>
        <Input
          id="wf-task-title"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="Rappeler {{ params.firstName }} {{ params.lastName }}"
        />
        <HelperText>Les {'{{ params.x }}'} du lead sont remplacés à la création.</HelperText>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wf-task-description">Description (optionnel)</Label>
        <Input
          id="wf-task-description"
          value={value.description ?? ''}
          onChange={(e) => onChange({ ...value, description: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wf-task-due">Échéance (jours après l’étape)</Label>
        <Input
          id="wf-task-due"
          type="number"
          min={0}
          max={365}
          className="w-32"
          value={value.dueInDays !== undefined ? String(value.dueInDays) : ''}
          onChange={(e) =>
            onChange({
              ...value,
              dueInDays: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
        />
        <HelperText>0 = le jour même ; vide = tâche sans date.</HelperText>
      </div>
      <div className="space-y-1.5">
        <Label>Propriétaire</Label>
        <Select
          value={(value.ownerId as string | undefined) ?? LEAD_OWNER}
          onValueChange={(v) =>
            onChange({ ...value, ownerId: v === LEAD_OWNER ? undefined : (v as Id<'users'>) })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LEAD_OWNER}>
              Responsable du lead (sinon l’auteur du workflow)
            </SelectItem>
            {employees.map((e) => (
              <SelectItem key={e._id} value={e._id}>
                {e.firstName} {e.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function DealStageStepConfig({
  value,
  onChange,
}: {
  value: DealStageNode;
  onChange: (next: DealStageNode) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PipelineStageFields
        pipelineId={value.pipelineId}
        stageKey={value.stageKey}
        onChange={(next) => onChange({ ...value, ...next })}
        pipelineHelper="Déplace la transaction ouverte la plus récente du lead (dans ce pipeline)."
        stageRequired
      />
    </div>
  );
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
