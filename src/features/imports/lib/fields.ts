import { DEFAULT_COUNTRY, type Id, type PropertyValue } from '@crm/lib/backend';
import { propertyTypeUi } from '../../properties/lib/propertyTypes';
import type { PropertyDefinitionRow } from '../../properties/types';

/*
 * The field registries: one declarative list per entity of the columns a file may map to, how a cell is parsed
 * and where the value lands in the row sent to the server. Custom properties are targets too (`custom:<defId>`).
 */

/** Lookup maps resolving human-readable cell values to document ids. */
export interface ImportContext {
  userByEmail: Map<string, Id<'users'>>;
  /** Lowercased stage key AND label → stage key (appConfig.lifecycle). */
  lifecycleStageByName: Map<string, string>;
}

export type ParseResult = { value: unknown } | { error: string };

export type AddressKey =
  | 'streetNumber'
  | 'street'
  | 'line2'
  | 'postalCode'
  | 'city'
  | 'region'
  | 'country';
export type AddressParts = Partial<Record<AddressKey, string>>;

/** Declarative definition of one importable column. */
export interface ImportFieldDef<Row> {
  /** Lowercased header that maps to this field, and the target id in a saved mapping. */
  header: string;
  /** French label, used in error messages and the mapping dropdown. */
  label: string;
  required?: boolean;
  /** Dropdown group this target belongs to (defaults to the entity's main group). */
  group?: string;
  /** Other headers that mean the same column, lowercased (HubSpot, Excel in French). */
  aliases?: string[];
  /** Validate/coerce a non-empty trimmed cell. Return `error` to reject the row. */
  parse: (raw: string, ctx: ImportContext) => ParseResult;
  /** Write the coerced value into the row being built (or the address parts). */
  apply: (row: Row, value: unknown, parts: AddressParts) => void;
}

export const ADDRESS_GROUP = 'Adresse';
export const CUSTOM_GROUP = 'Propriétés personnalisées';

/** Prefix marking a mapping target that points at a custom property (`custom:<defId>`). */
export const CUSTOM_TARGET_PREFIX = 'custom:';

/** Split a multi-value cell on `;`, trimming and dropping empties. */
export const splitMulti = (raw: string): string[] =>
  raw
    .replace(/^\[|\]$/g, '') // tolerate array-style cells: "[]" -> empty, "[a;b]" -> "a;b"
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

const TRUE_WORDS = new Set(['1', 'true', 'vrai', 'oui', 'yes', 'o', 'y', 'x']);
const FALSE_WORDS = new Set(['0', 'false', 'faux', 'non', 'no', 'n', '']);

/** oui/non, true/false, 1/0…; `undefined` when the cell says neither. */
export function parseBool(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return undefined;
}

/** A date cell to 'YYYY-MM-DD': ISO, French dd/mm/yyyy, or what the xlsx reader wrote. */
export function parseDateCell(raw: string): string | undefined {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
  return undefined;
}

/** A date or date-time cell to a timestamp (ms), the day at 09:00 local when no time is given. */
export function parseDateTimeCell(raw: string): number | undefined {
  const date = parseDateCell(raw);
  if (!date) return undefined;
  const time = raw.trim().match(/(\d{1,2}):(\d{2})/);
  const d = new Date(`${date}T${time ? `${time[1].padStart(2, '0')}:${time[2]}` : '09:00'}:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

/** `;`-separated employee emails; unknown users are skipped. */
export function parseOwners(raw: string, ctx: ImportContext): Id<'users'>[] {
  return raw
    .split(';')
    .map((e) => ctx.userByEmail.get(e.trim().toLowerCase()))
    .filter((id): id is Id<'users'> => !!id);
}

/** Match a cell against an option by its value or label (case-insensitive). */
function matchOption(def: PropertyDefinitionRow, raw: string): string | undefined {
  const needle = raw.trim().toLowerCase();
  return (def.options ?? []).find(
    (o) => o.value.toLowerCase() === needle || o.label.toLowerCase() === needle,
  )?.value;
}

type CustomParseResult = { value: PropertyValue } | { error: string };

/** Coerce a non-empty cell into the typed value the property expects, the shape `sanitizeCustomProperties` re-validates server-side. */
export function coerceCustomPropertyValue(
  def: PropertyDefinitionRow,
  raw: string,
): CustomParseResult {
  return propertyTypeUi(def.type).coerceCsv(def, raw, { matchOption, splitMulti, parseBool });
}

export const customTargetDefId = (target: string): string | null =>
  target.startsWith(CUSTOM_TARGET_PREFIX) ? target.slice(CUSTOM_TARGET_PREFIX.length) : null;

export interface TargetOption {
  id: string;
  label: string;
}
export interface TargetGroup {
  label: string;
  options: TargetOption[];
}

/** The dropdown of the mapping table: the entity's fields by group, then its custom properties. */
export function buildTargetGroups<Row>(
  fields: readonly ImportFieldDef<Row>[],
  mainGroup: string,
  customDefs: PropertyDefinitionRow[],
): TargetGroup[] {
  const groups = new Map<string, TargetOption[]>();
  for (const f of fields) {
    const group = f.group ?? mainGroup;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)?.push({ id: f.header, label: f.label });
  }
  const out = Array.from(groups, ([label, options]) => ({ label, options }));
  if (customDefs.length) {
    out.push({
      label: CUSTOM_GROUP,
      options: customDefs.map((d) => ({ id: `${CUSTOM_TARGET_PREFIX}${d._id}`, label: d.label })),
    });
  }
  return out;
}

/** The target a header maps to by itself: a field's header or alias, else a custom property by its label. */
export function autoDetectTarget<Row>(
  header: string,
  fields: readonly ImportFieldDef<Row>[],
  customDefs: PropertyDefinitionRow[],
): string | null {
  const h = header.trim().toLowerCase();
  if (!h) return null;
  const field = fields.find((f) => f.header === h || f.aliases?.includes(h));
  if (field) return field.header;
  const custom = customDefs.find((d) => d.label.trim().toLowerCase() === h);
  return custom ? `${CUSTOM_TARGET_PREFIX}${custom._id}` : null;
}

// Leading French street number: "30", "35B", "46 bis", "1 ter".
const STREET_NUMBER_RE = /^\s*(\d+(?:[a-z]|\s+(?:bis|ter|quater|quinquies))?)\s+(.+)$/i;

function splitLeadingStreetNumber(street: string): { streetNumber: string; street: string } {
  const m = street.match(STREET_NUMBER_RE);
  if (!m) return { streetNumber: '', street: street.trim() };
  return { streetNumber: m[1].replace(/\s+/g, ' ').trim(), street: m[2].trim() };
}

export interface ImportAddress {
  country: string;
  streetNumber: string;
  street: string;
  line2?: string;
  postalCode: string;
  city: string;
  region?: string;
}

/**
 * Assemble the nested address. Requires street, postal code and city; the street number is optional and is
 * pulled out of the street's leading token when the dedicated part is empty (e.g. "30 RUE DE LA CHENAIE").
 */
export function buildAddress(parts: AddressParts): ImportAddress | undefined {
  if (!parts.street || !parts.postalCode || !parts.city) return undefined;
  let streetNumber = parts.streetNumber?.trim() ?? '';
  let street = parts.street.trim();
  if (!streetNumber) {
    const split = splitLeadingStreetNumber(street);
    streetNumber = split.streetNumber;
    street = split.street;
  }
  return {
    country: parts.country ?? DEFAULT_COUNTRY,
    streetNumber,
    street,
    line2: parts.line2?.trim() || undefined,
    postalCode: parts.postalCode,
    city: parts.city,
    region: parts.region?.trim() || undefined,
  };
}

/** The address columns, shared by contacts and companies. */
export function addressFields<Row extends { address?: ImportAddress }>(): ImportFieldDef<Row>[] {
  const part = (key: AddressKey, label: string, aliases: string[] = []): ImportFieldDef<Row> => ({
    header: key.toLowerCase(),
    label,
    group: ADDRESS_GROUP,
    aliases,
    parse: (raw) => ({ value: raw }),
    apply: (_row, value, parts) => {
      parts[key] = value as string;
    },
  });
  return [
    part('streetNumber', 'N° de rue', ['numéro', 'numero']),
    part('street', 'Rue', ['adresse', 'address', 'rue', 'voie']),
    part('line2', 'Complément d’adresse', ['addressline2', 'complément', 'complement']),
    part('postalCode', 'Code postal', ['cp', 'zip', 'code postal', 'postal code']),
    part('city', 'Ville', ['ville', 'commune']),
    part('region', 'Région', ['région', 'state']),
    {
      header: 'country',
      label: 'Pays (code)',
      group: ADDRESS_GROUP,
      aliases: ['pays'],
      parse: (raw) => {
        const code = raw.trim().toUpperCase();
        return /^[A-Z]{2}$/.test(code)
          ? { value: code }
          : { error: `code pays invalide « ${raw} »` };
      },
      apply: (_row, value, parts) => {
        parts.country = value as string;
      },
    },
  ];
}
