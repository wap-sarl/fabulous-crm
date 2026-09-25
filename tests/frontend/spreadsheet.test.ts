import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  detectDelimiter,
  numberOrUndefined,
  parseCsv,
} from '../../src/features/imports/lib/parseCsv';
import { readSpreadsheet, readXlsx } from '../../src/features/imports/lib/readXlsx';

/** A minimal workbook the way Excel writes one: shared strings, a date style, inline strings, booleans, empty cells. */
function workbook(rows: (string | number | boolean | { date: number } | null)[][]): Uint8Array {
  const shared: string[] = [];
  const sst = (s: string) => {
    const i = shared.indexOf(s);
    if (i >= 0) return i;
    shared.push(s);
    return shared.length - 1;
  };
  const col = (i: number) => String.fromCharCode(65 + i);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sheetRows = rows
    .map((cells, r) => {
      const xml = cells
        .map((cell, c) => {
          const ref = `${col(c)}${r + 1}`;
          if (cell === null) return '';
          if (typeof cell === 'boolean') return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
          if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
          if (typeof cell === 'object') return `<c r="${ref}" s="1"><v>${cell.date}</v></c>`;
          // Every other string goes through the shared table, the first one inline, as writers mix both.
          if (r === 0 && c === 0)
            return `<c r="${ref}" t="inlineStr"><is><t>${esc(cell)}</t></is></c>`;
          return `<c r="${ref}" t="s"><v>${sst(cell)}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${xml}</row>`;
    })
    .join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="r"><sheets><sheet name="Feuil1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/data.xml"/></Relationships>',
    ),
    'xl/worksheets/data.xml': strToU8(`<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`),
    'xl/sharedStrings.xml': strToU8(
      `<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
    ),
    'xl/styles.xml': strToU8(
      '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    ),
  };
  return zipSync(files);
}

describe('spreadsheet readers', () => {
  test('csv: the delimiter of the header line, a BOM, quotes and a decimal comma', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b;c\n')).toBe(',');
    expect(detectDelimiter('"a;b",c\n')).toBe(',');
    expect(detectDelimiter('a\tb\n')).toBe('\t');
    expect(parseCsv('﻿Prénom;Nom\nJean;"Dupont; fils"\n')).toEqual([
      ['Prénom', 'Nom'],
      ['Jean', 'Dupont; fils'],
    ]);
    expect(parseCsv('a,b\r\n"x ""y""",2')).toEqual([
      ['a', 'b'],
      ['x "y"', '2'],
    ]);
    expect(numberOrUndefined('1 234,5')).toBe(1234.5);
    expect(numberOrUndefined('12.5')).toBe(12.5);
    expect(numberOrUndefined('abc')).toBeUndefined();
  });

  test('xlsx and csv of the same sheet give the same rows', async () => {
    const rows = [
      ['Prénom', 'Nom', 'E-mail', 'Montant', 'Date', 'Signalé', 'Note'],
      ['Ada', 'Lovelace', 'ada@example.com', 1500, { date: 46388 }, true, 'a & b <c>'],
      ['Bob', null, 'bob@example.com', 0.1, null, false, ''],
    ];
    const xlsx = readXlsx(workbook(rows));
    const csv = parseCsv(
      [
        'Prénom;Nom;E-mail;Montant;Date;Signalé;Note',
        'Ada;Lovelace;ada@example.com;1500;2027-01-01;true;a & b <c>',
        'Bob;;bob@example.com;0.1;;false;',
      ].join('\n'),
    );
    expect(xlsx).toEqual(csv);
    const viaFile = await readSpreadsheet(
      {
        name: 'x.XLSX',
        arrayBuffer: async () => workbook(rows).buffer as ArrayBuffer,
        text: async () => '',
      },
      parseCsv,
    );
    expect(viaFile).toEqual(csv);
  });

  test('xlsx: a time in a date cell, a big integer, a workbook without shared strings', () => {
    const files = {
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>46388.5</v></c><c r="C1"><v>123456789012</v></c><c r="D1" t="str"><v>=A1</v></c></row></sheetData></worksheet>',
      ),
      'xl/styles.xml': strToU8(
        '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>',
      ),
    };
    expect(readXlsx(zipSync(files))).toEqual([['2027-01-01 12:00', '', '123456789012', '=A1']]);
  });
});
