/**
 * Parse CSV text into rows of string cells (RFC 4180-ish).
 *
 * Handles `"` quoted fields that may contain the delimiter, newlines and escaped quotes (`""`). The delimiter is
 * the one the header line uses most among `,`, `;` and tab (French Excel writes `;`); a leading BOM is dropped.
 * Callers skip rows whose cells are all empty.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = delimiter ?? detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < source.length) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === sep) {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush the final field/row when the text does not end with a newline.
  if (field.length > 0 || row.length > 0) pushRow();

  return rows;
}

/** The delimiter of the first line, counted outside quotes; a comma when nothing shows. */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return best && best[1] > 0 ? best[0] : ',';
}

/** Parse a trimmed numeric string; `undefined` when empty, `NaN`-safe. A French decimal comma is accepted. */
export function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim().replace(/\s/g, '');
  if (!trimmed) return undefined;
  const n = Number(
    trimmed.includes(',') && !trimmed.includes('.') ? trimmed.replace(',', '.') : trimmed,
  );
  return Number.isFinite(n) ? n : undefined;
}
