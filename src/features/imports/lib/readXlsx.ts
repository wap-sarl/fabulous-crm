import { strFromU8, unzipSync } from 'fflate';

/*
 * A reader for the one thing an import needs from a workbook: the cells of its first sheet as text, the way
 * Excel shows them. A .xlsx is a zip of XML parts; the parts are machine-written, so a few regular expressions
 * read them without an XML parser, and the file never leaves the browser.
 */

const decodeXml = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Every `<t>` inside a string item, rich runs included. */
const textOf = (xml: string): string =>
  Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (m) => decodeXml(m[1])).join('');

/** Built-in number formats that show a date or a time (ECMA-376 §18.8.30). */
const DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

/** Whether a custom format code shows a date: day, month, year or hour tokens outside quotes and brackets. */
function isDateFormat(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '');
  return /[dmyhs]/i.test(bare) && !/^[#0.,%E+\-()\s]*$/i.test(bare);
}

/** Cell style index → whether the style shows a date. */
function dateStyles(stylesXml: string | undefined): boolean[] {
  if (!stylesXml) return [];
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    custom.set(Number(m[1]), decodeXml(m[2]));
  }
  const cellXfs = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  return Array.from(cellXfs.matchAll(/<xf\b([^>]*)\/?>/g), (m) => {
    const id = Number(m[1].match(/numFmtId="(\d+)"/)?.[1] ?? 0);
    const code = custom.get(id);
    return code !== undefined ? isDateFormat(code) : DATE_FORMAT_IDS.has(id);
  });
}

/** An Excel serial day to the text a person reads: the date, with the time when the cell has one. */
function serialToText(serial: number): string {
  // Excel counts days from 1899-12-30 (its 1900 leap-year bug included).
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const seconds = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  return seconds === 0 ? date : `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** A number as Excel shows it in a general cell: no exponent for the usual sizes, no trailing zeros. */
function numberToText(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(15)));
}

const columnIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** The path of the first sheet in workbook order, else the conventional one. */
function firstSheetPath(files: Record<string, Uint8Array>): string {
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels']
    ? strFromU8(files['xl/_rels/workbook.xml.rels'])
    : '';
  const rid = workbook.match(/<sheet\s[^>]*r:id="([^"]+)"/)?.[1];
  const target = rid
    ? (rels.match(new RegExp(`<Relationship\\s[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ??
      rels.match(new RegExp(`<Relationship\\s[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1])
    : undefined;
  if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  return 'xl/worksheets/sheet1.xml';
}

/** The first sheet of a workbook as rows of text cells; a cell that is empty in Excel is an empty string. */
export function readXlsx(data: ArrayBuffer | Uint8Array): string[][] {
  const files = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
  const sheetPath = firstSheetPath(files);
  const sheet = files[sheetPath];
  if (!sheet) throw new Error('xlsx_no_sheet');
  const shared = files['xl/sharedStrings.xml']
    ? Array.from(strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g), (m) =>
        textOf(m[1]),
      )
    : [];
  const dated = dateStyles(files['xl/styles.xml'] ? strFromU8(files['xl/styles.xml']) : undefined);
  const rows: string[][] = [];
  for (const rowMatch of strFromU8(sheet).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const col = ref ? columnIndex(ref) : cells.length;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const style = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? -1);
      const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = '';
      if (type === 's') text = shared[Number(value)] ?? '';
      else if (type === 'inlineStr') text = textOf(inner);
      else if (type === 'str' || type === 'e') text = value === undefined ? '' : decodeXml(value);
      else if (type === 'b') text = value === '1' ? 'true' : 'false';
      else if (type === 'd') text = value ?? '';
      else if (value !== undefined)
        text = dated[style] ? serialToText(Number(value)) : numberToText(value);
      while (cells.length < col) cells.push('');
      cells[col] = text;
    }
    rows.push(cells);
  }
  return rows;
}

/** A file to rows of text: a workbook by its bytes, anything else as CSV text. */
export async function readSpreadsheet(
  file: { name: string; arrayBuffer: () => Promise<ArrayBuffer>; text: () => Promise<string> },
  parseCsv: (text: string) => string[][],
): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) return readXlsx(await file.arrayBuffer());
  return parseCsv(await file.text());
}
