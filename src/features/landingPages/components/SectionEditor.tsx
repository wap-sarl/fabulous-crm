import { MAX_PAGE_SECTIONS } from '@crm/lib/backend';
import type { Id, LandingSection } from '@crm/lib/backend';
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  SortableList,
} from '@crm/design-system';
import { Plus, Trash2 } from 'lucide-react';
import { emptySection, SECTION_LABEL } from '../lib/templates';
import { type FormOption, SectionFields } from './SectionFields';

interface SectionEditorProps {
  sections: LandingSection[];
  onChange: (next: LandingSection[]) => void;
  forms: FormOption[];
}

const TYPES = Object.keys(SECTION_LABEL) as LandingSection['type'][];

/** The blocks of the page in order: each is edited in place, moved by its handle, removed; a new one is appended. */
export function SectionEditor({ sections, onChange, forms }: SectionEditorProps) {
  const replace = (next: LandingSection) =>
    onChange(sections.map((s) => (s.id === next.id ? next : s)));
  const remove = (id: string) => onChange(sections.filter((s) => s.id !== id));
  const add = (type: LandingSection['type']) =>
    onChange([...sections, emptySection(type, forms[0]?._id as Id<'forms'> | undefined)]);

  return (
    <div className="flex flex-col gap-3">
      {sections.length === 0 && (
        <p className="text-sm text-faint">Aucun bloc. Ajoutez-en un pour composer la page.</p>
      )}
      <SortableList
        items={sections}
        getId={(s) => s.id}
        onReorder={onChange}
        renderItem={(section, _index, handle) => (
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2">
              {handle}
              <span className="text-[13px] font-bold text-ink">{SECTION_LABEL[section.type]}</span>
              <IconButton
                aria-label="Retirer le bloc"
                variant="destructive"
                size="sm"
                className="ml-auto"
                onClick={() => remove(section.id)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
            <SectionFields section={section} onChange={replace} forms={forms} />
          </Card>
        )}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="self-start"
            disabled={sections.length >= MAX_PAGE_SECTIONS}
          >
            <Plus className="size-4" />
            Ajouter un bloc
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {TYPES.map((type) => (
            <DropdownMenuItem key={type} onSelect={() => add(type)}>
              {SECTION_LABEL[type]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
