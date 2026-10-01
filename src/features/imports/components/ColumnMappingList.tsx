import type { Dispatch, SetStateAction } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type { TargetGroup } from '../lib/fields';
import { IGNORE } from '../lib/mappingValues';

/** One line per column of the file: its header, a sample value and the field it goes to. */
export function ColumnMappingList({
  header,
  sampleRow,
  mapping,
  setMapping,
  targetGroups,
}: {
  header: string[];
  sampleRow: string[];
  mapping: (string | null)[];
  setMapping: Dispatch<SetStateAction<(string | null)[]>>;
  targetGroups: TargetGroup[];
}) {
  return (
    <div className="max-h-96 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
      {header.map((h, c) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a column is its position, two may carry the same header
        <div key={`${c}-${h}`} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs">{h.trim() || `Colonne ${c + 1}`}</p>
            {sampleRow[c]?.trim() && (
              <p className="truncate text-[11px] text-muted-foreground">
                ex. {sampleRow[c].trim()}
              </p>
            )}
          </div>
          <span className="text-muted-foreground">→</span>
          <Select
            value={mapping[c] ?? IGNORE}
            onValueChange={(val) =>
              setMapping((prev) => {
                const next = [...prev];
                next[c] = val === IGNORE ? null : val;
                return next;
              })
            }
          >
            <SelectTrigger className="h-8 w-64 shrink-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={IGNORE}>Ignorer</SelectItem>
              {targetGroups.map((g) => (
                <SelectGroup key={g.label}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
