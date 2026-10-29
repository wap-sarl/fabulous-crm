/** The rules every drop zone applies before a file reaches its consumer: what a file is, how big, how many. */
export interface FileRules {
  /** MIME types (`image/png`), MIME families (`image/*`) or extensions (`.csv`); nothing accepts any file. */
  accept?: readonly string[];
  /** The ceiling per file, in bytes. */
  maxBytes?: number;
  /** Several files at once; a single zone refuses a drop of several. */
  multiple?: boolean;
}

type FileRefusalReason = 'type' | 'size' | 'count';

export interface FileRefusal {
  file: File | null;
  reason: FileRefusalReason;
}

/** The format a MIME type is called by; anything else goes by its subtype. */
const FORMAT_NAMES: Record<string, string> = {
  'image/png': 'PNG',
  'image/svg+xml': 'SVG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'image/x-icon': 'ICO',
  'image/vnd.microsoft.icon': 'ICO',
  'text/html': 'HTML',
  'text/csv': 'CSV',
  'text/plain': 'TXT',
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace('.0', '').replace('.', ',') : Math.round(mb)} Mo`;
}

const formatNameOf = (entry: string): string => {
  if (entry.startsWith('.')) return entry.slice(1).toUpperCase();
  if (entry.endsWith('/*')) return entry === 'image/*' ? 'images' : entry.slice(0, -2);
  return FORMAT_NAMES[entry] ?? (entry.split('/')[1] ?? entry).toUpperCase();
};

/** The accepted formats as a sentence fragment: « PNG, SVG, JPEG ou WebP ». */
export function acceptLabel(accept: readonly string[]): string {
  const names = [...new Set(accept.map(formatNameOf))];
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}`;
}

/** The constraints the zone validates, in one line: formats and ceiling; null when nothing is checked. */
export function constraintsLabel(rules: FileRules): string | null {
  const parts: string[] = [];
  if (rules.accept && rules.accept.length > 0) parts.push(acceptLabel(rules.accept));
  if (rules.maxBytes !== undefined) {
    parts.push(`${formatFileSize(rules.maxBytes)} max${rules.multiple ? ' par fichier' : ''}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

const matchesAccept = (file: File, entry: string): boolean => {
  if (entry.startsWith('.')) return file.name.toLowerCase().endsWith(entry.toLowerCase());
  if (entry.endsWith('/*')) return file.type.startsWith(entry.slice(0, -1));
  return file.type === entry;
};

/** Sorts a selection into the files the consumer receives and the refusals the zone shows. */
export function checkFiles(
  files: readonly File[],
  rules: FileRules,
): { accepted: File[]; refusals: FileRefusal[] } {
  if (!rules.multiple && files.length > 1) {
    return { accepted: [], refusals: [{ file: null, reason: 'count' }] };
  }
  const accepted: File[] = [];
  const refusals: FileRefusal[] = [];
  for (const file of files) {
    const accept = rules.accept ?? [];
    if (accept.length > 0 && !accept.some((entry) => matchesAccept(file, entry))) {
      refusals.push({ file, reason: 'type' });
    } else if (rules.maxBytes !== undefined && file.size > rules.maxBytes) {
      refusals.push({ file, reason: 'size' });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, refusals };
}

/** The sentence a refusal is shown as, next to the field. */
export function describeFileRefusal({ file, reason }: FileRefusal, rules: FileRules): string {
  const name = file ? `« ${file.name} » : ` : '';
  switch (reason) {
    case 'count':
      return 'Déposez un seul fichier.';
    case 'type':
      return `${name}format non pris en charge${rules.accept?.length ? ` (${acceptLabel(rules.accept)})` : ''}.`;
    case 'size':
      return `${name}fichier trop volumineux (${formatFileSize(file?.size ?? 0)}, maximum ${formatFileSize(rules.maxBytes ?? 0)}).`;
  }
}
