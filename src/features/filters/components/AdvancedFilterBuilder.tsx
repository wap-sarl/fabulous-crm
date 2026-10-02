import { useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@crm/design-system';
import { Filter } from 'lucide-react';
import type { AdvancedFilter } from '@crm/lib/backend';
import { countActiveRules, emptyAdvancedFilter, type FieldCatalog } from '../lib/advancedFilter';
import { AdvancedFilterGroupsEditor } from './AdvancedFilterGroupsEditor';

interface Props<F extends string> {
  filter: AdvancedFilter<F> | undefined;
  onChange: (next: AdvancedFilter<F> | undefined) => void;
  /** The entity's filterable fields: built-in columns + custom definitions. */
  catalog: FieldCatalog<F>;
}

export function AdvancedFilterBuilder<F extends string>({ filter, onChange, catalog }: Props<F>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdvancedFilter<F>>(
    () => filter ?? emptyAdvancedFilter(catalog.standard),
  );

  // The draft starts from the applied filter each time the dialog opens; a URL change while it is open leaves the edits alone.
  const openChange = (next: boolean) => {
    if (next) {
      setDraft(filter && filter.groups.length > 0 ? filter : emptyAdvancedFilter(catalog.standard));
    }
    setOpen(next);
  };

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
    <Dialog open={open} onOpenChange={openChange}>
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
