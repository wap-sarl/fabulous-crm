import {
  DatePicker,
  Input,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type { FilterFieldType, FilterRange, FilterRule } from '@crm/lib/backend';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { useLifecycleConfig } from '../../leads/hooks/useLifecycleConfig';

interface RuleValueInputProps<F extends string> {
  rule: FilterRule<F>;
  type: FilterFieldType;
  /** Fixed choices of a list-valued field (definition options or built-in list). */
  options: { value: string; label: string }[];
  onChange: (next: FilterRule<F>) => void;
}

/** The value control for a rule, chosen by field type + operator. */
export function RuleValueInput<F extends string>({
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
