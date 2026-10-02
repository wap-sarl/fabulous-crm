import {
  Combobox,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import { X } from 'lucide-react';
import type { FilterOperator, FilterRule } from '@crm/lib/backend';
import { operatorsForType } from '@crm/lib/backend';
import {
  decodeField,
  encodeField,
  type FieldCatalog,
  fieldItemsOf,
  fieldOptionsOf,
  fieldTypeOf,
  operatorLabel,
} from '../lib/advancedFilter';
import { RuleValueInput } from './RuleValueInput';

interface RuleRowProps<F extends string> {
  rule: FilterRule<F>;
  catalog: FieldCatalog<F>;
  canRemove: boolean;
  onChange: (next: FilterRule<F>) => void;
  onRemove: () => void;
}

export function RuleRow<F extends string>({
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
