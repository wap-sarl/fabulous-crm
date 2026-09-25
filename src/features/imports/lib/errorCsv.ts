/** The rows in error as a CSV the person can fix and import again: the source columns, then the error. */
export function errorRowsCsv(
  headers: string[],
  rows: { line: number; raw: string[]; error: string }[],
): string {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [[...headers, 'Ligne', 'Erreur'].map(quote).join(';')];
  for (const row of rows) {
    lines.push(
      [...headers.map((_, c) => row.raw[c] ?? ''), String(row.line), row.error]
        .map(quote)
        .join(';'),
    );
  }
  // A BOM so Excel reads the accents; `;` as French Excel expects.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
