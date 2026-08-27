import type { LucideIcon } from 'lucide-react';
import { File, FileImage, FileSpreadsheet, FileText, FileVideo } from 'lucide-react';
import type { AttachmentRow } from '@crm/lib/backend';

/** « 1,2 Mo » style size. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} Mo`;
}

export type PreviewKind = 'image' | 'pdf' | null;

/** What the preview dialog can render inline. */
export function previewKindOf(mimeType: string): PreviewKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  return null;
}

export function fileIconOf(mimeType: string): LucideIcon {
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType.startsWith('video/')) return FileVideo;
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) return FileText;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv')
    return FileSpreadsheet;
  return File;
}

/** Direct children of `folder`: sub-folder names (unique) and the files stored right there. */
export function folderContents(rows: AttachmentRow[], folder: string) {
  const prefix = folder ? `${folder}/` : '';
  const subfolders = new Set<string>();
  const files: AttachmentRow[] = [];
  for (const row of rows) {
    if (row.folder === folder) {
      files.push(row);
    } else if (row.folder.startsWith(prefix)) {
      subfolders.add(row.folder.slice(prefix.length).split('/')[0]);
    }
  }
  return { subfolders: [...subfolders].sort((a, b) => a.localeCompare(b, 'fr')), files };
}

/** Every folder path present in the tree (for the "move to" picker), root included. */
export function allFolders(rows: AttachmentRow[]): string[] {
  const out = new Set<string>(['']);
  for (const row of rows) {
    const parts = row.folder ? row.folder.split('/') : [];
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'fr'));
}

export function breadcrumbs(folder: string): { path: string; label: string }[] {
  const parts = folder ? folder.split('/') : [];
  return parts.map((label, i) => ({ path: parts.slice(0, i + 1).join('/'), label }));
}
