import { useState } from 'react';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuthQuery, useAuthMutation } from '@crm/widgets';
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Spinner,
  Textarea,
  toast,
} from '@crm/design-system';
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';

const noteDateFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type LeadNote = {
  _id: Id<'leadNotes'>;
  content: string;
  isPinned: boolean;
  authorName: string | null;
  createdAt: number;
  updatedAt: number;
};

export function LeadNotes({ leadId }: { leadId: Id<'leads'> }) {
  const notes = useAuthQuery(api.features.crm.queries.listLeadNotes, { leadId });

  const createNote = useAuthMutation(api.features.crm.mutations.createNote);
  const updateNote = useAuthMutation(api.features.crm.mutations.updateNote);
  const setNotePinned = useAuthMutation(api.features.crm.mutations.setNotePinned);
  const deleteNote = useAuthMutation(api.features.crm.mutations.deleteNote);

  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<Id<'leadNotes'> | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const handleCreate = async () => {
    const content = draft.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    try {
      await createNote({ leadId, content });
      setDraft('');
    } catch {
      toast.error("Impossible d'ajouter la note.");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (note: LeadNote) => {
    setEditingId(note._id);
    setEditDraft(note.content);
  };

  const handleSaveEdit = async (noteId: Id<'leadNotes'>) => {
    const content = editDraft.trim();
    if (!content) return;
    try {
      await updateNote({ noteId, content });
      setEditingId(null);
      setEditDraft('');
    } catch {
      toast.error('Impossible de modifier la note.');
    }
  };

  const handleTogglePin = async (note: LeadNote) => {
    try {
      await setNotePinned({ noteId: note._id, isPinned: !note.isPinned });
    } catch {
      toast.error("Impossible d'épingler la note.");
    }
  };

  const handleDelete = async (noteId: Id<'leadNotes'>) => {
    if (!window.confirm('Supprimer cette note ?')) return;
    try {
      await deleteNote({ noteId });
    } catch {
      toast.error('Impossible de supprimer la note.');
    }
  };

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-[15px] font-bold text-ink">Notes</h2>

      <div className="mb-4 flex flex-col gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ajouter une note…"
          rows={3}
          className="min-h-[64px]"
        />
        <Button
          size="sm"
          className="self-end"
          disabled={!draft.trim() || submitting}
          onClick={handleCreate}
        >
          Ajouter
        </Button>
      </div>

      {notes === undefined ? (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-sm text-faint">Aucune note.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => {
            const isEditing = editingId === note._id;
            return (
              <li
                key={note._id}
                className={
                  'rounded-lg border p-3 ' +
                  (note.isPinned ? 'border-primary/30 bg-primary-soft/40' : 'bg-card')
                }
              >
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={3}
                      className="min-h-[64px]"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft('');
                        }}
                      >
                        Annuler
                      </Button>
                      <Button
                        size="sm"
                        disabled={!editDraft.trim()}
                        onClick={() => handleSaveEdit(note._id)}
                      >
                        Enregistrer
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-body">
                        {note.content}
                      </p>
                      <div className="flex shrink-0 items-center">
                        <IconButton
                          size="sm"
                          variant={note.isPinned ? 'primary' : 'default'}
                          aria-label={note.isPinned ? 'Désépingler' : 'Épingler'}
                          onClick={() => handleTogglePin(note)}
                        >
                          {note.isPinned ? (
                            <PinOff className="size-4" />
                          ) : (
                            <Pin className="size-4" />
                          )}
                        </IconButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton size="sm" aria-label="Actions">
                              <MoreHorizontal className="size-4" />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => startEdit(note)}>
                              <Pencil className="size-4" />
                              Modifier
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => handleDelete(note._id)}
                            >
                              <Trash2 className="size-4" />
                              Supprimer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-faint">
                      {note.authorName ?? 'Inconnu'} · {noteDateFormat.format(note.createdAt)}
                    </p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
