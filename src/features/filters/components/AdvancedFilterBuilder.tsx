import { Fragment, useEffect, useState } from 'react';
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
  FilterFieldType,
  FilterGroup,
  FilterOperator,
  FilterRange,
  FilterRule,
} from '@crm/lib/backend';
import { operatorsForType } from '@crm/lib/backend';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { useLifecycleConfig } from '../../leads/hooks/useLifecycleConfig';
import {
  countActiveRules,
  decodeField,
  emptyAdvancedFilter,
  emptyGroup,
  emptyRule,
  encodeField,
  type FieldCatalog,
  fieldItemsOf,
  fieldOptionsOf,
  fieldTypeOf,
  operatorLabel,
} from '../lib/advancedFilter';

interface Props<F extends string> {
  filter: AdvancedFilter<F> | undefined;
  onChange: (next: AdvancedFilter<F> | undefined) => void;
  /** The entity's filterable fields: built-in columns + custom definitions. */
  catalog: FieldCatalog<F>;
}

const COMBINATOR_ITEMS: { value: FilterCombinator; label: string }[] = [
  { value: 'and', label: 'ET' },
  { value: 'or', label: 'OU' },
];

export function AdvancedFilterBuilder<F extends string>({ filter, onChange, catalog }: Props<F>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdvancedFilter<F>>(
    () => filter ?? emptyAdvancedFilter(catalog.standard),
  );

  // Reseed the draft from the applied filter each time the dialog opens.
  useEffect(() => {
    if (open)
      setDraft(filter && filter.groups.length > 0 ? filter : emptyAdvancedFilter(catalog.standard));
    // Intentionally keyed only on `open` so external URL changes don't stomp edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeCount = countActiveRules(filter);

  const apply = () => {
    onChange(countActiveRules(draft) > 0 ? draft : undefined);
    setOpen(false);
  };
  const reset = () => {
    setDraft(emptyAdvancedFilter(catalog.standard));
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
          <AdvancedFilterGroupsEditor value={draft} onChange={setDraft} catalog={catalog} />
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

interface GroupsEditorProps<F extends string> {
  value: AdvancedFilter<F>;
  onChange: (next: AdvancedFilter<F>) => void;
  catalog: FieldCatalog<F>;
}

export function AdvancedFilterGroupsEditor<F extends string>({
  value,
  onChange,
  catalog,
}: GroupsEditorProps<F>) {
  const setGroup = (gi: number, updater: (g: FilterGroup<F>) => FilterGroup<F>) =>
    onChange({ ...value, groups: value.groups.map((g, i) => (i === gi ? updater(g) : g)) });
  const setRule = (gi: number, ri: number, next: FilterRule<F>) =>
    setGroup(gi, (g) => ({ ...g, rules: g.rules.map((r, i) => (i === ri ? next : r)) }));

  const addRule = (gi: number) =>
    setGroup(gi, (g) => ({ ...g, rules: [...g.rules, emptyRule(catalog.standard)] }));
  const removeRule = (gi: number, ri: number) =>
    setGroup(gi, (g) => ({ ...g, rules: g.rules.filter((_, i) => i !== ri) }));
  const addGroup = () =>
    onChange({ ...value, groups: [...value.groups, emptyGroup(catalog.standard)] });
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
            catalog={catalog}
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

interface GroupBlockProps<F extends string> {
  group: FilterGroup<F>;
  catalog: FieldCatalog<F>;
  canRemove: boolean;
  onCombinatorChange: (c: FilterCombinator) => void;
  onRuleChange: (ri: number, next: FilterRule<F>) => void;
  onAddRule: () => void;
  onRemoveRule: (ri: number) => void;
  onRemoveGroup: () => void;
}

function GroupBlock<F extends string>({
  group,
  catalog,
  canRemove,
  onCombinatorChange,
  onRuleChange,
  onAddRule,
  onRemoveRule,
  onRemoveGroup,
}: GroupBlockProps<F>) {
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
          catalog={catalog}
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

interface RuleRowProps<F extends string> {
  rule: FilterRule<F>;
  catalog: FieldCatalog<F>;
  canRemove: boolean;
  onChange: (next: FilterRule<F>) => void;
  onRemove: () => void;
}

function RuleRow<F extends string>({
  rule,
  catalog,
  canRemove,
  onChange,
  onRemove,
}: RuleRowProps<F>) {
  const type = fieldTypeOf(rule.field, catalog);
  const operators = operatorsForType(type);

  const handleFieldChange = (key: string) => {
    const field = decodeField<F>(key);
    const nextType = fieldTypeOf(field, catalog);
    onChange({ field, operator: operatorsForType(nextType)[0], value: undefined });
  };

  const handleOperatorChange = (op: FilterOperator) => {
    onChange({ ...rule, operator: op, value: undefined });
  };

  return (
    <div className="flex items-start gap-2">
      <div className="w-44 shrink-0">
        <Combobox
          items={fieldItemsOf(catalog)}
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
                {operatorLabel(type, op)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 flex-1">
        <RuleValueInput
          rule={rule}
          type={type}
          options={fieldOptionsOf(rule.field, catalog)}
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

interface RuleValueInputProps<F extends string> {
  rule: FilterRule<F>;
  type: FilterFieldType;
  /** Fixed choices of a list-valued field (definition options or built-in list). */
  options: { value: string; label: string }[];
  onChange: (next: FilterRule<F>) => void;
}

/** The value control for a rule, chosen by field type + operator. */
function RuleValueInput<F extends string>({
  rule,
  type,
  options,
  onChange,
}: RuleValueInputProps<F>) {
  const { operator, value } = rule;
  const lifecycle = useLifecycleConfig();
  const { employees } = useEmployees();

  // Presence operators take no value.
  if (operator === 'isEmpty' || operator === 'isNotEmpty') {
    return <span className="block py-2 text-sm text-faint">—</span>;
  }

  const setValue = (v: FilterRule<F>['value']) => onChange({ ...rule, value: v });

  if (operator === 'inLastDays' || operator === 'inNextDays' || operator === 'moreThanDaysAgo') {
    return (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          step={1}
          placeholder="N"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) =>
            setValue(
              e.target.value === '' ? undefined : Math.max(1, Math.floor(Number(e.target.value))),
            )
          }
        />
        <span className="text-sm text-faint">jours</span>
      </div>
    );
  }

  const asString = typeof value === 'string' ? value : '';
  const asNumber = typeof value === 'number' ? String(value) : '';
  const asArray = Array.isArray(value) ? value : [];
  const asRange: FilterRange =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  if (operator === 'between') {
    if (type === 'date' || type === 'timestamp') {
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

  const multi = (items: { value: string; label: string }[]) => (
    <MultiSelect
      items={items}
      value={asArray}
      onValueChange={(v) => setValue(v.length > 0 ? v : undefined)}
      placeholder="Sélectionner…"
      modal
      className="w-full"
    />
  );

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
    case 'timestamp':
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
      return multi(lifecycle.stages.map((s) => ({ value: s.key, label: s.label })));

    case 'assignee':
      return multi(employees.map((e) => ({ value: e._id, label: `${e.firstName} ${e.lastName}` })));

    case 'select':
    case 'checkbox':
    case 'list':
      return multi(options);

    // text / email → free text
    default:
      return <Input value={asString} onChange={(e) => setValue(e.target.value || undefined)} />;
  }
}
