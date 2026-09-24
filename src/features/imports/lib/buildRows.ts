import type { ImportEntity } from '@crm/lib/backend';
import type { PropertyDefinitionRow } from '../../properties/types';
import {
  type AddressParts,
  buildAddress,
  coerceCustomPropertyValue,
  customTargetDefId,
  type ImportContext,
  type ImportFieldDef,
} from './fields';
import { IMPORT_SPECS, type ImportRowOf } from './registry';

/** A row as `appendRows` takes it: built, or refused with the reason. */
export interface BuiltRow<E extends ImportEntity> {
  index: number;
  line: number;
  raw: string[];
  data?: ImportRowOf[E];
  error?: string;
}

export interface BuiltFile<E extends ImportEntity> {
  rows: BuiltRow<E>[];
  invalid: number;
  /** Non-empty headers no target was chosen for. */
  ignored: string[];
}

/** The required targets a mapping lacks, by label. */
export function missingRequired(entity: ImportEntity, mapping: (string | null)[]): string[] {
  const fields = IMPORT_SPECS[entity].fields as readonly ImportFieldDef<unknown>[];
  return fields.filter((f) => f.required && !mapping.includes(f.header)).map((f) => f.label);
}

/**
 * Turn the parsed sheet into rows through the mapping: every mapped cell is parsed by its field, a failing cell
 * refuses the whole row (no partial record), the address parts are assembled last. Line numbers count the header.
 */
export function buildRows<E extends ImportEntity>(
  entity: E,
  parsed: string[][],
  mapping: (string | null)[],
  ctx: ImportContext,
  customDefs: PropertyDefinitionRow[],
): BuiltFile<E> {
  const fields = IMPORT_SPECS[entity].fields as readonly ImportFieldDef<ImportRowOf[E]>[];
  const fieldByHeader = new Map(fields.map((f) => [f.header, f]));
  const defById = new Map(customDefs.map((d) => [d._id as string, d]));
  const header = parsed[0] ?? [];
  const rows: BuiltRow<E>[] = [];
  let invalid = 0;
  for (let r = 1; r < parsed.length; r++) {
    const cells = parsed[r];
    const line = r + 1;
    const row = {} as ImportRowOf[E];
    const parts: AddressParts = {};
    const errors: string[] = [];
    for (let c = 0; c < header.length; c++) {
      const target = mapping[c];
      if (!target) continue;
      const trimmed = (cells[c] ?? '').trim();
      // The export's "NULL" marker is an empty cell across every column.
      const cell = trimmed.toUpperCase() === 'NULL' ? '' : trimmed;
      const customId = customTargetDefId(target);
      if (customId) {
        const def = defById.get(customId);
        if (!def || cell === '') continue;
        const res = coerceCustomPropertyValue(def, cell);
        if ('error' in res) {
          errors.push(`${def.label} : ${res.error}`);
          continue;
        }
        const withProps = row as { customProperties?: Record<string, unknown> };
        withProps.customProperties ??= {};
        withProps.customProperties[def._id] = res.value;
        continue;
      }
      const field = fieldByHeader.get(target);
      if (!field) continue;
      if (cell === '') {
        if (field.required) errors.push(`${field.label} requis`);
        continue;
      }
      const res = field.parse(cell, ctx);
      if ('error' in res) {
        errors.push(res.error);
        continue;
      }
      field.apply(row, res.value, parts);
    }
    const raw = header.map((_, c) => cells[c] ?? '');
    if (errors.length) {
      invalid += 1;
      rows.push({ index: rows.length, line, raw, error: [...new Set(errors)].join(' ; ') });
      continue;
    }
    const address = buildAddress(parts);
    if (address) (row as { address?: typeof address }).address = address;
    rows.push({ index: rows.length, line, raw, data: row });
  }
  const ignored = header.filter((h, c) => h.trim() !== '' && !mapping[c]);
  return { rows, invalid, ignored };
}
