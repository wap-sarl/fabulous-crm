import { useEffect, useImperativeHandle, type Ref } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { cn } from '@crm/design-system';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@crm/design-system';
import {
  Bold,
  Braces,
  Heading1,
  Heading2,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  MousePointerClick,
  type LucideIcon,
} from 'lucide-react';

/** Imperative insertion API used by the tracked-link modal (owned by the parent). */
export interface EmailBodyEditorHandle {
  insertToken: (token: string) => void;
  /** Insert a clickable anchor whose href is a {{ params.x }} placeholder. */
  insertLink: (href: string, label: string) => void;
}

interface Props {
  value: string;
  onChange: (html: string) => void;
  /** Placeholders substituted per recipient at send time (see createCampaign). */
  placeholders: { label: string; token: string }[];
  /** When set, adds a "Lien de suivi" toolbar button that opens the parent's modal. */
  onRequestTrackedLink?: () => void;
  ref?: Ref<EmailBodyEditorHandle>;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * WYSIWYG editor for composing the HTML body of a custom email campaign.
 * Controlled via `value` (HTML) / `onChange`. Output is TipTap's semantic HTML;
 * it is wrapped in an email shell and placeholder-substituted at send time.
 */
export function EmailBodyEditor({ value, onChange, placeholders, onRequestTrackedLink, ref }: Props) {
  const editor = useEditor({
    extensions: [
      // StarterKit bundles its own Link; disable it so our configured Link wins.
      StarterKit.configure({ link: false }),
      // Allow any URI so placeholder hrefs like {{ params.consentUrl }} survive.
      Link.configure({ openOnClick: false, autolink: false, isAllowedUri: () => true }),
      Image,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none min-h-[240px] px-4 py-3 focus:outline-none',
          'prose-headings:font-semibold prose-a:text-primary'
        ),
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Keep the editor in sync when the value is reset externally (e.g. clearing).
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  useImperativeHandle(
    ref,
    () => ({
      insertToken: (token) => editor?.chain().focus().insertContent(`${token} `).run(),
      insertLink: (href, label) =>
        editor
          ?.chain()
          .focus()
          .insertContent(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a> `)
          .run(),
    }),
    [editor]
  );

  if (!editor) return null;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
        <ToolbarButton
          icon={Bold}
          label="Gras"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          icon={Italic}
          label="Italique"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          icon={Heading1}
          label="Titre 1"
          active={editor.isActive('heading', { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        />
        <ToolbarButton
          icon={Heading2}
          label="Titre 2"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          icon={List}
          label="Liste à puces"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon={ListOrdered}
          label="Liste numérotée"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon={Link2}
          label="Lien"
          active={editor.isActive('link')}
          onClick={() => setLink(editor)}
        />
        <ToolbarButton
          icon={ImageIcon}
          label="Image"
          onClick={() => insertImage(editor)}
        />

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-faint transition hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft"
            >
              <Braces className="size-4" aria-hidden="true" />
              Insérer un champ
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {placeholders.map((p) => (
              <DropdownMenuItem
                key={p.token}
                onSelect={() => editor.chain().focus().insertContent(`${p.token} `).run()}
              >
                {p.label}
                <span className="ml-auto pl-3 text-xs text-faint">{p.token}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {onRequestTrackedLink && (
          <button
            type="button"
            onClick={onRequestTrackedLink}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-faint transition hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft"
          >
            <MousePointerClick className="size-4" aria-hidden="true" />
            Lien de suivi
          </button>
        )}
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}

interface ToolbarButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}

function ToolbarButton({ icon: Icon, label, active, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft',
        active ? 'bg-primary text-white' : 'text-faint hover:bg-muted hover:text-ink'
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

function setLink(editor: Editor) {
  const previous = (editor.getAttributes('link').href as string | undefined) ?? '';
  const url = window.prompt('URL du lien (les champs {{ params.x }} sont autorisés)', previous);
  if (url === null) return; // cancelled
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

function insertImage(editor: Editor) {
  const url = window.prompt('URL de l’image');
  if (!url) return;
  editor.chain().focus().setImage({ src: url }).run();
}
