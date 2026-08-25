import type { Id, LeadStatus, LeadPropertyValue } from '@crm/lib/backend';
import { isValidEmail, isValidPhone } from '@crm/lib/shared';
import { LEAD_STATUSES } from '../../../lib/constants';
import type { LeadPropertyDefinitionRow } from '../types';

/**
 * Shape of a single parsed row sent to the `importLeads` mutation. Mirrors the
 * mutation's `rows` validator; required fields are guaranteed by the required
 * header check before parsing.
 */
export interface LeadImportRow {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  status?: LeadStatus;
  lifecycleStage?: string;
  comment?: string;
  isRedFlagged?: boolean;
  assignedTo?: Id<'users'>;
  address?: {
    streetNumber: string;
    street: string;
    postalCode: string;
    city: string;
    country: string;
  };
  /** Custom-property values, keyed by definition id (see leadPropertyDefinitions). */
  customProperties?: Record<string, LeadPropertyValue>;
  /** Company columns: matched (registration number, domain) or created (name). */
  company?: { name?: string; country?: string; registrationNumber?: string; domain?: string };
}

/** Lookup maps resolving human-readable cell values to document ids. */
export interface ImportContext {
  userByEmail: Map<string, Id<'users'>>;
  /** Lowercased stage key AND label → stage key (appConfig.lifecycle). */
  lifecycleStageByName: Map<string, string>;
}

type AddressKey = 'streetNumber' | 'street' | 'postalCode' | 'city';
export type AddressParts = Partial<Record<AddressKey, string>>;

type ParseResult = { value: unknown } | { error: string };

/** Declarative definition of one importable CSV column. */
export interface ImportFieldDef {
  /** Lowercased CSV header that maps to this field. */
  header: string;
  /** French label, used in error messages and the mapping dropdown. */
  label: string;
  required?: boolean;
  /** Dropdown group this target belongs to (defaults to {@link LEAD_FIELDS_GROUP}). */
  group?: string;
  /** Validate/coerce a non-empty trimmed cell. Return `error` to reject the row. */
  parse: (raw: string, ctx: ImportContext) => ParseResult;
  /** Write the coerced value into the row being built (or the address parts). */
  apply: (row: LeadImportRow, value: unknown, parts: AddressParts) => void;
}

const VALID_STATUSES = new Set<string>(LEAD_STATUSES.map((s) => s.value));

/** Dropdown group labels for the mapping table. */
export const LEAD_FIELDS_GROUP = 'Champs du lead';
export const ADDRESS_GROUP = 'Adresse';
export const COMPANY_GROUP = 'Entreprise';
export const CUSTOM_GROUP = 'Propriétés personnalisées';

/** Prefix marking a mapping target that points at a custom property (`custom:<defId>`). */
export const CUSTOM_TARGET_PREFIX = 'custom:';

/** Split a multi-value cell on `;`, trimming and dropping empties. */
const splitMulti = (raw: string): string[] =>
  raw
    .replace(/^\[|\]$/g, '') // tolerate array-style cells: "[]" -> empty, "[a;b]" -> "a;b"
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);

function parseBool(raw: string): boolean | undefined {
  const v = raw.toLowerCase();
  if (['true', '1', 'oui', 'yes', 'vrai'].includes(v)) return true;
  if (['false', '0', 'non', 'no', 'faux'].includes(v)) return false;
  return undefined;
}

/** The row's company block, created on first use. */
function companyOf(row: LeadImportRow): NonNullable<LeadImportRow['company']> {
  if (!row.company) row.company = {};
  return row.company;
}

function addrField(header: string, label: string, key: AddressKey): ImportFieldDef {
  return {
    header,
    label,
    group: ADDRESS_GROUP,
    parse: (raw) => ({ value: raw }),
    apply: (_row, value, parts) => {
      parts[key] = value as string;
    },
  };
}

/**
 * Registry of every importable lead field. The CSV import matches each header
 * (case-insensitive) against `header` here; unknown columns are ignored.
 * Multi-value cells (`marketingconsent`) are `;`-separated.
 */
export const IMPORT_FIELDS: ImportFieldDef[] = [
  {
    header: 'firstname',
    label: 'Prénom',
    required: true,
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.firstName = value as string;
    },
  },
  {
    header: 'lastname',
    label: 'Nom',
    required: true,
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.lastName = value as string;
    },
  },
  {
    header: 'email',
    label: 'E-mail',
    parse: (raw) => (isValidEmail(raw) ? { value: raw } : { error: `e-mail invalide « ${raw} »` }),
    apply: (row, value) => {
      row.email = value as string;
    },
  },
  {
    header: 'phone',
    label: 'Téléphone',
    // Invalid phone numbers are dropped (left empty) rather than rejecting the row.
    parse: (raw) => (isValidPhone(raw) ? { value: raw } : { value: undefined }),
    apply: (row, value) => {
      if (value) row.phone = value as string;
    },
  },
  {
    header: 'status',
    label: 'Statut',
    parse: (raw) => {
      const s = raw.toLowerCase();
      return VALID_STATUSES.has(s) ? { value: s } : { error: `statut inconnu « ${raw} »` };
    },
    apply: (row, value) => {
      row.status = value as LeadStatus;
    },
  },
  {
    header: 'lifecyclestage',
    label: 'Cycle de vie',
    parse: (raw, ctx) => {
      const key = ctx.lifecycleStageByName.get(raw.trim().toLowerCase());
      return key ? { value: key } : { error: `étape du cycle de vie inconnue « ${raw} »` };
    },
    apply: (row, value) => {
      row.lifecycleStage = value as string;
    },
  },
  {
    header: 'comment',
    label: 'Commentaire',
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      row.comment = value as string;
    },
  },
  {
    header: 'isredflagged',
    label: 'Signalé',
    parse: (raw) => {
      const b = parseBool(raw);
      return b === undefined ? { error: `valeur booléenne invalide « ${raw} »` } : { value: b };
    },
    apply: (row, value) => {
      row.isRedFlagged = value as boolean;
    },
  },
  {
    header: 'assignedto',
    label: 'Assigné à',
    // Unknown (or absent) user is left unset; the import mutation defaults it
    // to the importing employee.
    parse: (raw, ctx) => ({ value: ctx.userByEmail.get(raw.toLowerCase()) }),
    apply: (row, value) => {
      if (value) row.assignedTo = value as Id<'users'>;
    },
  },
  {
    header: 'company',
    label: 'Entreprise (nom)',
    group: COMPANY_GROUP,
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      companyOf(row).name = value as string;
    },
  },
  {
    header: 'companyregistrationnumber',
    label: 'Entreprise — n° d’immatriculation (SIRET…)',
    group: COMPANY_GROUP,
    // Validated server-side against the company country's scheme.
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      companyOf(row).registrationNumber = value as string;
    },
  },
  {
    header: 'companydomain',
    label: 'Entreprise — domaine',
    group: COMPANY_GROUP,
    parse: (raw) => ({ value: raw }),
    apply: (row, value) => {
      companyOf(row).domain = value as string;
    },
  },
  {
    header: 'companycountry',
    label: 'Entreprise — pays (code ISO)',
    group: COMPANY_GROUP,
    parse: (raw) =>
      /^[a-z]{2}$/i.test(raw.trim())
        ? { value: raw.trim().toUpperCase() }
        : { error: `code pays invalide « ${raw} » (2 lettres, ex. FR)` },
    apply: (row, value) => {
      companyOf(row).country = value as string;
    },
  },
  addrField('streetnumber', 'N°', 'streetNumber'),
  addrField('street', 'Rue', 'street'),
  addrField('postalcode', 'Code postal', 'postalCode'),
  addrField('city', 'Ville', 'city'),
];

/** All recognized CSV headers, in registry order. */
export const IMPORT_HEADERS = IMPORT_FIELDS.map((f) => f.header);

/** Built-in field lookup by header (its stable mapping-target id). */
const IMPORT_FIELD_BY_HEADER = new Map(IMPORT_FIELDS.map((f) => [f.header, f]));

/** Required built-in targets (a column must be mapped to each before import). */
export const REQUIRED_TARGETS = IMPORT_FIELDS.filter((f) => f.required).map((f) => ({
  id: f.header,
  label: f.label,
}));

/** One selectable target in the mapping dropdown. */
export interface ImportTargetOption {
  /** Built-in header, or `custom:<defId>`. */
  id: string;
  label: string;
}

/** A labelled group of targets (built-in fields, address, custom properties). */
export interface ImportTargetGroup {
  label: string;
  options: ImportTargetOption[];
}

/** Build the grouped target list for the mapping selects, given the live custom defs. */
export function buildImportTargetGroups(
  customDefs: LeadPropertyDefinitionRow[],
): ImportTargetGroup[] {
  const toOption = (f: ImportFieldDef): ImportTargetOption => ({ id: f.header, label: f.label });
  const groups: ImportTargetGroup[] = [
    {
      label: LEAD_FIELDS_GROUP,
      options: IMPORT_FIELDS.filter(
        (f) => (f.group ?? LEAD_FIELDS_GROUP) === LEAD_FIELDS_GROUP,
      ).map(toOption),
    },
    {
      label: ADDRESS_GROUP,
      options: IMPORT_FIELDS.filter((f) => f.group === ADDRESS_GROUP).map(toOption),
    },
    {
      label: COMPANY_GROUP,
      options: IMPORT_FIELDS.filter((f) => f.group === COMPANY_GROUP).map(toOption),
    },
  ];
  if (customDefs.length) {
    groups.push({
      label: CUSTOM_GROUP,
      options: customDefs.map((d) => ({ id: `${CUSTOM_TARGET_PREFIX}${d._id}`, label: d.label })),
    });
  }
  return groups;
}

/** If `targetId` points at a custom property, return its definition id; else null. */
export function customTargetDefId(targetId: string): string | null {
  return targetId.startsWith(CUSTOM_TARGET_PREFIX)
    ? targetId.slice(CUSTOM_TARGET_PREFIX.length)
    : null;
}

/** Look up the built-in field a target id maps to (undefined for custom/ignored). */
export function builtinFieldForTarget(targetId: string): ImportFieldDef | undefined {
  return IMPORT_FIELD_BY_HEADER.get(targetId);
}

/**
 * Pre-fill a column's target from its header: an exact built-in header match, or
 * a custom property whose label matches (both case-insensitive). Null otherwise.
 */
export function autoDetectTarget(
  header: string,
  customDefs: LeadPropertyDefinitionRow[],
): string | null {
  const h = header.trim().toLowerCase();
  if (IMPORT_FIELD_BY_HEADER.has(h)) return h;
  const custom = customDefs.find((d) => d.label.trim().toLowerCase() === h);
  return custom ? `${CUSTOM_TARGET_PREFIX}${custom._id}` : null;
}

/** Match a cell against an option by its value or label (case-insensitive). */
function matchOption(def: LeadPropertyDefinitionRow, raw: string): string | undefined {
  const needle = raw.trim().toLowerCase();
  return (def.options ?? []).find(
    (o) => o.value.toLowerCase() === needle || o.label.toLowerCase() === needle,
  )?.value;
}

type CustomParseResult = { value: LeadPropertyValue } | { error: string };

/**
 * Coerce a non-empty CSV cell into the typed value the property expects. The
 * result is the exact JS type `sanitizeCustomProperties` re-validates server-side
 * (string / finite number / boolean / string[] of option values).
 */
export function coerceCustomPropertyValue(
  def: LeadPropertyDefinitionRow,
  raw: string,
): CustomParseResult {
  switch (def.type) {
    case 'text':
    case 'email':
    case 'date':
      return { value: raw };
    case 'rpps':
      // Store the bare digits; server-side validation enforces the 11-digit rule.
      return { value: raw.replace(/\D/g, '') };
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? { value: n } : { error: `nombre invalide « ${raw} »` };
    }
    case 'boolean': {
      const b = parseBool(raw);
      return b === undefined ? { error: `valeur booléenne invalide « ${raw} »` } : { value: b };
    }
    case 'select':
    case 'radio': {
      const value = matchOption(def, raw);
      return value ? { value } : { error: `option inconnue « ${raw} »` };
    }
    case 'checkbox': {
      const values: string[] = [];
      for (const token of splitMulti(raw)) {
        const value = matchOption(def, token);
        if (!value) return { error: `option inconnue « ${token} »` };
        values.push(value);
      }
      return { value: values };
    }
    default:
      return { value: raw };
  }
}

// Leading French street number: "30", "35B", "46 bis", "1 ter".
const STREET_NUMBER_RE = /^\s*(\d+(?:[a-z]|\s+(?:bis|ter|quater|quinquies))?)\s+(.+)$/i;

/**
 * Pull a leading street number out of a free-form street line. Returns the
 * number (e.g. "35B", "46 bis") and the street with it stripped. When no
 * leading number is present, returns an empty number and the street unchanged.
 */
function splitLeadingStreetNumber(street: string): { streetNumber: string; street: string } {
  const m = street.match(STREET_NUMBER_RE);
  if (!m) return { streetNumber: '', street: street.trim() };
  return { streetNumber: m[1].replace(/\s+/g, ' ').trim(), street: m[2].trim() };
}

/**
 * Assemble the nested address. Requires street, postal code and city; the
 * street number is optional. When the dedicated `streetNumber` part is empty,
 * derive it from the leading token of `street` (e.g. "30 RUE DE LA CHENAIE").
 */
export function buildAddress(parts: AddressParts): LeadImportRow['address'] | undefined {
  if (!parts.street || !parts.postalCode || !parts.city) return undefined;
  let streetNumber = parts.streetNumber?.trim() ?? '';
  let street = parts.street.trim();
  if (!streetNumber) {
    const split = splitLeadingStreetNumber(street);
    streetNumber = split.streetNumber;
    street = split.street;
  }
  return {
    streetNumber,
    street,
    postalCode: parts.postalCode,
    city: parts.city,
    country: 'France',
  };
}
