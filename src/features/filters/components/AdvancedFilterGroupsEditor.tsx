import { Fragment } from 'react';
import { Button, SegmentedControl } from '@crm/design-system';
import { Plus } from 'lucide-react';
import type { AdvancedFilter, FilterGroup, FilterRule } from '@crm/lib/backend';
import { emptyGroup, emptyRule, type FieldCatalog } from '../lib/advancedFilter';
import { COMBINATOR_ITEMS } from '../lib/combinatorItems';
import { GroupBlock } from './GroupBlock';

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
        // biome-ignore lint/suspicious/noArrayIndexKey: a group has no identity but its place, and its rows hold no state of their own
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
