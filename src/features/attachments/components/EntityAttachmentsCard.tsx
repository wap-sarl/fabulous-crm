import { useRef, useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { AttachmentEntityType, AttachmentRow } from '@crm/lib/backend';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  cn,
  toast,
} from '@crm/design-system';
import {
  ChevronRight,
  Download,
  Eye,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import { attachmentErrorMessage, useAttachmentActions } from '../hooks/useAttachmentActions';
import {
  allFolders,
  breadcrumbs,
  fileIconOf,
  folderContents,
  formatFileSize,
  previewKindOf,
} from '../lib/files';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const ROOT_LABEL = 'Fichiers';

interface EntityAttachmentsCardProps {
  entityType: AttachmentEntityType;
  entityId: string;
}

/**
 * « Fichiers » card of a lead / company / deal page: a folder tree the user
 * organizes (the same tree an object store would show), drag-and-drop upload
 * into the current folder, inline preview of images and PDFs, download,
 * rename / move / delete.
 */
export function EntityAttachmentsCard({ entityType, entityId }: EntityAttachmentsCardProps) {
  const rows = useAuthQuery(api.features.attachments.queries.listAttachments, {
    entityType,
    entityId,
  });
  const limits = useAuthQuery(api.features.attachments.queries.getAttachmentLimits, {});
  const { uploadFile, updateAttachment, deleteAttachment } = useAttachmentActions();
  const [folder, setFolder] = useState('');
  // Folders exist only through their files; a freshly created one lives here until a file lands in it.
  const [draftFolders, setDraftFolders] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [previewing, setPreviewing] = useState<AttachmentRow | null>(null);
  const [editing, setEditing] = useState<AttachmentRow | null>(null);
  const [deleting, setDeleting] = useState<AttachmentRow | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const all = rows ?? [];
  const { subfolders, files } = folderContents(all, folder);
  const prefix = folder ? `${folder}/` : '';
  const draftHere = draftFolders
    .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/'))
    .map((f) => f.slice(prefix.length))
    .filter((f) => !subfolders.includes(f));
  const visibleFolders = [...subfolders, ...draftHere].sort((a, b) => a.localeCompare(b, 'fr'));

  const handleFiles = async (list: FileList | File[]) => {
    const picked = Array.from(list);
    if (picked.length === 0) return;
    const max = limits?.maxSizeBytes;
    const tooBig = max ? picked.filter((f) => f.size > max) : [];
    if (tooBig.length > 0) {
      toast.error(
        `${tooBig.map((f) => f.name).join(', ')} : fichier trop volumineux (maximum ${formatFileSize(max ?? 0)}).`,
      );
    }
    const accepted = picked.filter((f) => !tooBig.includes(f));
    if (accepted.length === 0) return;
    setUploading({ done: 0, total: accepted.length });
    let failed = 0;
    for (const [i, file] of accepted.entries()) {
      try {
        await uploadFile(entityType, entityId, file, folder);
      } catch (e) {
        failed++;
        toast.error(`${file.name} : ${attachmentErrorMessage(e, 'échec de l’envoi.')}`);
      }
      setUploading({ done: i + 1, total: accepted.length });
    }
    setUploading(null);
    if (accepted.length - failed > 0) {
      toast.success(`${accepted.length - failed} fichier(s) ajouté(s).`);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteAttachment({ attachmentId: deleting._id });
      toast.success('Fichier supprimé.');
    } catch (e) {
      toast.error(attachmentErrorMessage(e, 'Échec de la suppression.'));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card className="p-5" data-testid="entity-attachments-card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-ink">Fichiers</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setNewFolderOpen(true)}>
            <FolderPlus className="size-4" />
            Dossier
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading !== null}
            data-testid="add-attachment"
          >
            <Upload className="size-4" />
            Ajouter
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <nav
        className="mb-2 flex flex-wrap items-center gap-1 text-xs text-faint"
        aria-label="Dossier"
      >
        <button
          type="button"
          onClick={() => setFolder('')}
          className={cn('hover:text-ink', folder === '' && 'font-semibold text-ink')}
        >
          {ROOT_LABEL}
        </button>
        {breadcrumbs(folder).map((crumb, i, arr) => (
          <span key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="size-3" aria-hidden />
            <button
              type="button"
              onClick={() => setFolder(crumb.path)}
              className={cn('hover:text-ink', i === arr.length - 1 && 'font-semibold text-ink')}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      <section
        aria-label="Dépôt de fichiers"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'rounded-md border border-dashed p-2 transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border',
        )}
        data-testid="attachments-dropzone"
      >
        {rows === undefined ? (
          <Spinner size="sm" />
        ) : visibleFolders.length === 0 && files.length === 0 ? (
          <p className="py-4 text-center text-sm text-faint">
            Glissez des fichiers ici{limits ? ` (max ${formatFileSize(limits.maxSizeBytes)})` : ''}.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {visibleFolders.map((name) => (
              <li key={`folder:${name}`}>
                <button
                  type="button"
                  onClick={() => setFolder(prefix + name)}
                  className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-[#F7F8FA]"
                  data-testid="attachment-folder"
                >
                  <Folder className="size-4 shrink-0 text-amber-500" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                    {name}
                  </span>
                  <ChevronRight className="size-4 text-[#C8CCD4]" aria-hidden />
                </button>
              </li>
            ))}
            {files.map((file) => {
              const Icon = fileIconOf(file.mimeType);
              const canPreview = previewKindOf(file.mimeType) !== null && !!file.url;
              return (
                <li
                  key={file._id}
                  className="flex items-center gap-3 px-1 py-2"
                  data-testid="attachment-item"
                >
                  <Icon className="size-4 shrink-0 text-soft" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() =>
                        canPreview ? setPreviewing(file) : window.open(file.url ?? '', '_blank')
                      }
                      className="block max-w-full truncate text-left text-[13px] font-semibold text-ink hover:underline"
                      title={file.name}
                    >
                      {file.name}
                    </button>
                    <span className="block truncate text-xs text-faint">
                      {formatFileSize(file.size)} · {dateFormat.format(file._creationTime)}
                      {file.authorName ? ` · ${file.authorName}` : ''}
                    </span>
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton aria-label="Actions" variant="secondary" size="sm">
                        <MoreHorizontal className="size-4" />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canPreview && (
                        <DropdownMenuItem onSelect={() => setPreviewing(file)}>
                          <Eye className="size-4" /> Aperçu
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem asChild>
                        <a
                          href={file.url ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          download={file.name}
                        >
                          <Download className="size-4" /> Télécharger
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setEditing(file)}>
                        <Pencil className="size-4" /> Renommer / déplacer
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setDeleting(file)}
                        className="text-destructive"
                      >
                        <Trash2 className="size-4" /> Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
        {uploading && (
          <p className="mt-2 flex items-center gap-2 text-xs text-faint">
            <Spinner size="sm" /> Envoi… {uploading.done}/{uploading.total}
          </p>
        )}
      </section>

      <PreviewDialog file={previewing} onClose={() => setPreviewing(null)} />
      {editing && (
        <EditAttachmentDialog
          file={editing}
          folders={[...new Set([...allFolders(all), ...draftFolders])].sort()}
          onClose={() => setEditing(null)}
          onSave={async (name, target) => {
            try {
              await updateAttachment({ attachmentId: editing._id, name, folder: target });
              toast.success('Fichier mis à jour.');
              setEditing(null);
            } catch (e) {
              toast.error(attachmentErrorMessage(e, 'Échec.'));
            }
          }}
        />
      )}
      <NewFolderDialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreate={(name) => {
          const path = prefix + name;
          setDraftFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
          setFolder(path);
          setNewFolderOpen(false);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Supprimer « ${deleting?.name ?? ''} » ?`}
        description="Le fichier est définitivement supprimé."
        confirmLabel="Supprimer"
        destructive
        onConfirm={remove}
      />
    </Card>
  );
}

function PreviewDialog({ file, onClose }: { file: AttachmentRow | null; onClose: () => void }) {
  const kind = file ? previewKindOf(file.mimeType) : null;
  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file?.name}</DialogTitle>
        </DialogHeader>
        {file?.url && kind === 'image' ? (
          <img src={file.url} alt={file.name} className="max-h-[70vh] w-full object-contain" />
        ) : file?.url && kind === 'pdf' ? (
          <iframe src={file.url} title={file.name} className="h-[70vh] w-full rounded-md border" />
        ) : (
          <p className="text-sm text-faint">Aperçu indisponible.</p>
        )}
        <DialogFooter>
          {file?.url && (
            <Button variant="outline" asChild>
              <a href={file.url} target="_blank" rel="noreferrer" download={file.name}>
                <Download className="size-4" />
                Télécharger
              </a>
            </Button>
          )}
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAttachmentDialog({
  file,
  folders,
  onClose,
  onSave,
}: {
  file: AttachmentRow;
  folders: string[];
  onClose: () => void;
  onSave: (name: string, folder: string) => Promise<void>;
}) {
  const ROOT = '__root__';
  const [name, setName] = useState(file.name);
  const [folder, setFolder] = useState(file.folder);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renommer / déplacer</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="attachment-name">Nom</Label>
            <Input id="attachment-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Dossier</Label>
            <Select value={folder || ROOT} onValueChange={(v) => setFolder(v === ROOT ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {folders.map((f) => (
                  <SelectItem key={f || ROOT} value={f || ROOT}>
                    {f ? f : ROOT_LABEL}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(name, folder);
              } finally {
                setBusy(false);
              }
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewFolderDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const submit = () => {
    const clean = name.trim().replace(/[\\/]+/g, '-');
    if (!clean) {
      toast.error('Nommez le dossier.');
      return;
    }
    onCreate(clean);
    setName('');
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nouveau dossier</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="new-folder-name">Nom</Label>
          <Input
            id="new-folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Devis, Contrats…"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit}>Créer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
