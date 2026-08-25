import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Combobox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  IconButton,
  Input,
  MultiSelect,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import { Filter, Plus, Trash2, X } from 'lucide-react';
import type {
  AdvancedFilter,
  FilterCombinator,
  FilterField,
  FilterGroup,
  FilterOperator,
  FilterRange,
  FilterRule,
  StandardField,
} from '@crm/lib/backend';
import { operatorsForType } from '@crm/lib/backend';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { CONSENT_CHANNELS } from '../../../lib/constants';
import { useLifecycleConfig } from '../hooks/useLifecycleConfig';
import type { LeadPropertyDefinitionRow } from '../types';
import {
  countActiveRules,
  emptyAdvancedFilter,
  emptyGroup,
  emptyRule,
  fieldTypeOf,
  OPERATOR_LABEL,
  STANDARD_FILTER_FIELDS,
} from '../lib/advancedFilter';

interface Props {
  filter: AdvancedFilter | undefined;
  onChange: (next: AdvancedFilter | undefined) => void;
  definitions: LeadPropertyDefinitionRow[];
}

/** Encode/decode a field to a flat string for the field Combobox. */
function encodeField(field: FilterField): string {
  return field.kind === 'standard' ? `std:${field.field}` : `cp:${field.definitionId}`;
}
function decodeField(key: string): FilterField {
  if (key.startsWith('cp:')) return { kind: 'custom', definitionId: key.slice(3) };
  return { kind: 'standard', field: key.slice(4) as StandardField };
}

const COMBINATOR_ITEMS: { value: FilterCombinator; label: string }[] = [
  { value: 'and', label: 'ET' },
  { value: 'or', label: 'OU' },
];

/**
 * Advanced two-level filter builder for the leads list. Groups of typed rules
 * combined with AND/OR, and the groups combined with AND/OR. Edits a local draft
 * and commits on "Appliquer"; the active-rule count on the trigger reflects the
 * applied filter.
 */
export function AdvancedFilterBuilder({ filter, onChange, definitions }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdvancedFilter>(() => filter ?? emptyAdvancedFilter());

  // Reseed the draft from the applied filter each time the dialog opens.
  useEffect(() => {
    if (open) setDraft(filter && filter.groups.length > 0 ? filter : emptyAdvancedFilter());
    // Intentionally keyed only on `open` so external URL changes don't stomp edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeCount = countActiveRules(filter);

  const apply = () => {
    onChange(countActiveRules(draft) > 0 ? draft : undefined);
    setOpen(false);
  };
  const reset = () => {
    setDraft(emptyAdvancedFilter());
    onChange(undefined);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="advanced-filters">
          <Filter className="h-4 w-4" />
          Filtres avancés
          {activeCount > 0 && (
            <Badge className="ml-1" variant="secondary">
              {activeCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Filtres avancés</DialogTitle>
          <DialogDescription>
            Combinez des règles par groupes. Choisissez ET/OU entre les règles d’un groupe et entre
            les groupes.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <AdvancedFilterGroupsEditor value={draft} onChange={setDraft} definitions={definitions} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={reset}>
            Réinitialiser
          </Button>
          <Button onClick={apply}>Appliquer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface GroupsEditorProps {
  value: AdvancedFilter;
  onChange: (next: AdvancedFilter) => void;
  definitions: LeadPropertyDefinitionRow[];
}

/**
 * The bare AND/OR groups editor, without the Dialog/draft shell — fully
 * controlled. Embedded directly by the workflow feature (trigger enrollment
 * criteria, if/else branch conditions) and by the Dialog above.
 */
export function AdvancedFilterGroupsEditor({ value, onChange, definitions }: GroupsEditorProps) {
  const { employees } = useEmployees();

  const defsById = useMemo(() => new Map(definitions.map((d) => [d._id, d])), [definitions]);

  const setGroup = (gi: number, updater: (g: FilterGroup) => FilterGroup) =>
    onChange({ ...value, groups: value.groups.map((g, i) => (i === gi ? updater(g) : g)) });
  const setRule = (gi: number, ri: number, next: FilterRule) =>
    setGroup(gi, (g) => ({ ...g, rules: g.rules.map((r, i) => (i === ri ? next : r)) }));

  const addRule = (gi: number) => setGroup(gi, (g) => ({ ...g, rules: [...g.rules, emptyRule()] }));
  const removeRule = (gi: number, ri: number) =>
    setGroup(gi, (g) => ({ ...g, rules: g.rules.filter((_, i) => i !== ri) }));
  const addGroup = () => onChange({ ...value, groups: [...value.groups, emptyGroup()] });
  const removeGroup = (gi: number) =>
    onChange({ ...value, groups: value.groups.filter((_, i) => i !== gi) });

  return (
    <>
      {value.groups.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-faint">Entre les groupes</span>
              <SegmentedControl
                aria-label="Opérateur entre les groupes"
                items={COMBINATOR_ITEMS}
                value={value.combinator}
                onChange={(c) => onChange({ ...value, combinator: c })}
              />
            </div>
          )}
          <GroupBlock
            group={group}
            defsById={defsById}
            definitions={definitions}
            employees={employees}
            canRemove={value.groups.length > 1}
            onCombinatorChange={(c) => setGroup(gi, (g) => ({ ...g, combinator: c }))}
            onRuleChange={(ri, next) => setRule(gi, ri, next)}
            onAddRule={() => addRule(gi)}
            onRemoveRule={(ri) => removeRule(gi, ri)}
            onRemoveGroup={() => removeGroup(gi)}
          />
        </Fragment>
      ))}

      <Button variant="ghost" onClick={addGroup}>
        <Plus className="h-4 w-4" />
        Ajouter un groupe
      </Button>
    </>
  );
}

interface GroupBlockProps {
  group: FilterGroup;
  defsById: Map<string, LeadPropertyDefinitionRow>;
  definitions: LeadPropertyDefinitionRow[];
  employees: { _id: string; firstName: string; lastName: string }[];
  canRemove: boolean;
  onCombinatorChange: (c: FilterCombinator) => void;
  onRuleChange: (ri: number, next: FilterRule) => void;
  onAddRule: () => void;
  onRemoveRule: (ri: number) => void;
  onRemoveGroup: () => void;
}

function GroupBlock({
  group,
  defsById,
  definitions,
  employees,
  canRemove,
  onCombinatorChange,
  onRuleChange,
  onAddRule,
  onRemoveRule,
  onRemoveGroup,
}: GroupBlockProps) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-faint">Correspondance</span>
          <SegmentedControl
            aria-label="Opérateur entre les règles"
            items={COMBINATOR_ITEMS}
            value={group.combinator}
            onChange={onCombinatorChange}
          />
        </div>
        {canRemove && (
          <IconButton
            aria-label="Supprimer le groupe"
            variant="destructive"
            size="sm"
            onClick={onRemoveGroup}
          >
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </div>

      {group.rules.map((rule, ri) => (
        <RuleRow
          key={ri}
          rule={rule}
          defsById={defsById}
          definitions={definitions}
          employees={employees}
          canRemove={group.rules.length > 1}
          onChange={(next) => onRuleChange(ri, next)}
          onRemove={() => onRemoveRule(ri)}
        />
      ))}

      <Button variant="ghost" size="sm" onClick={onAddRule}>
        <Plus className="h-4 w-4" />
        Ajouter une règle
      </Button>
    </div>
  );
}

interface RuleRowProps {
  rule: FilterRule;
  defsById: Map<string, LeadPropertyDefinitionRow>;
  definitions: LeadPropertyDefinitionRow[];
  employees: { _id: string; firstName: string; lastName: string }[];
  canRemove: boolean;
  onChange: (next: FilterRule) => void;
  onRemove: () => void;
}

function RuleRow({
  rule,
  defsById,
  definitions,
  employees,
  canRemove,
  onChange,
  onRemove,
}: RuleRowProps) {
  const type = fieldTypeOf(rule.field, defsById);
  const operators = operatorsForType(type);
  const def = rule.field.kind === 'custom' ? defsById.get(rule.field.definitionId) : undefined;

  const fieldItems = [
    ...STANDARD_FILTER_FIELDS.map((f) => ({ value: `std:${f.field}`, label: f.label })),
    ...definitions.map((d) => ({ value: `cp:${d._id}`, label: d.label })),
  ];

  const handleFieldChange = (key: string) => {
    const field = decodeField(key);
    const nextType = fieldTypeOf(field, defsById);
    onChange({ field, operator: operatorsForType(nextType)[0], value: undefined });
  };

  const handleOperatorChange = (op: FilterOperator) => {
    onChange({ ...rule, operator: op, value: undefined });
  };

  return (
    <div className="flex items-start gap-2">
      <div className="w-44 shrink-0">
        <Combobox
          items={fieldItems}
          value={encodeField(rule.field)}
          onValueChange={handleFieldChange}
          placeholder="Propriété"
          popoverWidth="w-64"
          modal
          className="w-full"
        />
      </div>

      <div className="w-40 shrink-0">
        <Select
          value={rule.operator}
          onValueChange={(v) => handleOperatorChange(v as FilterOperator)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((op) => (
              <SelectItem key={op} value={op}>
                {OPERATOR_LABEL[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 flex-1">
        <RuleValueInput
          rule={rule}
          type={type}
          def={def}
          employees={employees}
          onChange={onChange}
        />
      </div>

      <IconButton
        aria-label="Supprimer la règle"
        variant="secondary"
        size="sm"
        onClick={onRemove}
        disabled={!canRemove}
      >
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

interface RuleValueInputProps {
  rule: FilterRule;
  type: ReturnType<typeof fieldTypeOf>;
  def: LeadPropertyDefinitionRow | undefined;
  employees: { _id: string; firstName: string; lastName: string }[];
  onChange: (next: FilterRule) => void;
}

/** The value control for a rule, chosen by field type + operator. */
function RuleValueInput({ rule, type, def, employees, onChange }: RuleValueInputProps) {
  const { operator, value } = rule;
  const lifecycle = useLifecycleConfig();

  // Presence operators take no value.
  if (operator === 'isEmpty' || operator === 'isNotEmpty') {
    return <span className="block py-2 text-sm text-faint">—</span>;
  }

  const setValue = (v: FilterRule['value']) => onChange({ ...rule, value: v });

  const asString = typeof value === 'string' ? value : '';
  const asNumber = typeof value === 'number' ? String(value) : '';
  const asArray = Array.isArray(value) ? value : [];
  const asRange: FilterRange =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  const optionItems = (def?.options ?? []).map((o) => ({ value: o.value, label: o.label }));

  if (operator === 'between') {
    if (type === 'date') {
      return (
        <div className="flex items-center gap-2">
          <DatePicker
            value={typeof asRange.min === 'string' ? asRange.min : ''}
            onValueChange={(v) => setValue({ ...asRange, min: v || undefined })}
          />
          <span className="text-sm text-faint">et</span>
          <DatePicker
            value={typeof asRange.max === 'string' ? asRange.max : ''}
            onValueChange={(v) => setValue({ ...asRange, max: v || undefined })}
          />
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          placeholder="Min"
          value={typeof asRange.min === 'number' ? String(asRange.min) : ''}
          onChange={(e) =>
            setValue({
              ...asRange,
              min: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
        />
        <span className="text-sm text-faint">et</span>
        <Input
          type="number"
          placeholder="Max"
          value={typeof asRange.max === 'number' ? String(asRange.max) : ''}
          onChange={(e) =>
            setValue({
              ...asRange,
              max: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
        />
      </div>
    );
  }

  switch (type) {
    case 'number':
      return (
        <Input
          type="number"
          value={asNumber}
          onChange={(e) => setValue(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );

    case 'date':
      return <DatePicker value={asString} onValueChange={(v) => setValue(v || undefined)} />;

    case 'boolean':
      return (
        <Select
          value={value === true ? 'oui' : value === false ? 'non' : ''}
          onValueChange={(v) => setValue(v === 'oui')}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="oui">Oui</SelectItem>
            <SelectItem value="non">Non</SelectItem>
          </SelectContent>
        </Select>
      );

    case 'lifecycle':
      return (
        <MultiSelect
          items={lifecycle.stages.map((s) => ({ value: s.key, label: s.label }))}
          value={asArray}
          onValueChange={(v) => setValue(v.length > 0 ? v : undefined)}
          placeholder="Sélectionner…"
          modal
          className="w-full"
        />
      );

    case 'assignee':
      return (
        <MultiSelect
          items={employees.map((e) => ({ value: e._id, label: `${e.firstName} ${e.lastName}` }))}
          value={asArray}
          onValueChange={(v) => setValue(v.length > 0 ? v : undefined)}
          placeholder="Sélectionner…"
          modal
          className="w-full"
        />
      );

    case 'select':
    case 'checkbox': {
      // The standard `marketingConsent` field has fixed options (the consent
      // channels) rather than a custom-property definition's options.
      const isConsent = rule.field.kind === 'standard' && rule.field.field === 'marketingConsent';
      const items = isConsent
        ? CONSENT_CHANNELS.map((c) => ({ value: c.value, label: c.label }))
        : optionItems;
      return (
        <MultiSelect
          items={items}
          value={asArray}
          onValueChange={(v) => setValue(v.length > 0 ? v : undefined)}
          placeholder="Sélectionner…"
          modal
          className="w-full"
        />
      );
    }

    // text / email → free text
    default:
      return <Input value={asString} onChange={(e) => setValue(e.target.value || undefined)} />;
  }
}
