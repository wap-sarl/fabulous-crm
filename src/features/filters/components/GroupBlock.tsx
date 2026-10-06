import { Button, IconButton, SegmentedControl } from '@crm/design-system';
import { Plus, Trash2 } from 'lucide-react';
import type { FilterCombinator, FilterGroup, FilterRule } from '@crm/lib/backend';
import type { FieldCatalog } from '../lib/advancedFilter';
import { COMBINATOR_ITEMS } from '../lib/combinatorItems';
import { keyOf } from '../lib/rowKeys';
import { RuleRow } from './RuleRow';

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

export function GroupBlock<F extends string>({
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
          key={keyOf(rule)}
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
