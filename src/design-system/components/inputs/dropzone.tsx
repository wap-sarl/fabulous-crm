import { Upload } from 'lucide-react';
import {
  type DragEvent,
  type ReactNode,
  type Ref,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { cn } from '../../theme/utils';
import { Spinner } from '../feedback/spinner';
import { Button } from './button';
import {
  checkFiles,
  constraintsLabel,
  describeFileRefusal,
  type FileRules,
} from './dropzone-rules';
import { HelperText } from './helper-text';

/** What a consumer outside the zone may ask of it: open the file picker, as a toolbar button does. */
export interface DropzoneHandle {
  open: () => void;
}

export interface DropzoneProps extends FileRules {
  /** The id of the select button, for the field's `Label`. */
  id?: string;
  /** The instruction of the empty zone. */
  instruction?: string;
  /** The select button's words; « Remplacer » once a preview shows. */
  actionLabel?: string;
  /** What the empty zone shows above its instruction. */
  icon?: ReactNode;
  /** The loaded image, placed in a frame of the given shape; the zone then reads as filled. */
  preview?: ReactNode;
  previewShape?: 'square' | 'wide';
  /** What is known of the loaded file (its name, its rows), under the instruction. */
  description?: ReactNode;
  /** A recommendation the zone does not check, shown after the constraints it does. */
  hint?: ReactNode;
  /** The consumer's own error (an upload that failed), shown next to the field. */
  error?: string | null;
  disabled?: boolean;
  /** A file is being read or sent: the zone says so and takes nothing meanwhile. */
  busy?: boolean;
  busyLabel?: string;
  /** Receives the files that passed the rules; a refusal is shown by the zone itself. */
  onFiles: (files: File[]) => void;
  /** The zone's own content, a list of what was dropped before: it replaces the empty state. */
  children?: ReactNode;
  className?: string;
  ref?: Ref<DropzoneHandle>;
  'data-testid'?: string;
}

const PREVIEW_FRAME = { square: 'size-16', wide: 'h-16 w-28' };

const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';

/** One drop zone for the whole CRM: click, keyboard and drag share one validation, and every state looks the same. */
export function Dropzone({
  id,
  accept,
  maxBytes,
  multiple = false,
  instruction = multiple
    ? 'Glissez vos fichiers ici ou choisissez des fichiers'
    : 'Glissez votre fichier ici ou choisissez un fichier',
  actionLabel,
  icon,
  preview,
  previewShape = 'square',
  description,
  hint,
  error,
  disabled = false,
  busy = false,
  busyLabel = 'Envoi…',
  onFiles,
  children,
  className,
  ref,
  'data-testid': testId,
}: DropzoneProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const helpId = `${triggerId}-help`;
  const errorId = `${triggerId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const rules: FileRules = { accept, maxBytes, multiple };
  const inert = disabled || busy;
  const open = () => {
    if (!inert) inputRef.current?.click();
  };
  useImperativeHandle(ref, () => ({ open }));

  const receive = (list: FileList | null) => {
    if (inert || !list || list.length === 0) return;
    const { accepted, refusals } = checkFiles(Array.from(list), rules);
    setRefusal(refusals.map((r) => describeFileRefusal(r, rules)).join(' ') || null);
    if (accepted.length > 0) onFiles(accepted);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!inert && e.dataTransfer.types.includes('Files')) setDragOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    receive(e.dataTransfer.files);
  };

  const shownError = error ?? refusal;
  const constraints = constraintsLabel(rules);
  const filled = preview !== undefined && preview !== null;
  const state = busy ? 'busy' : shownError ? 'error' : filled || children ? 'filled' : 'empty';
  const describedBy = [constraints || hint ? helpId : null, shownError ? errorId : null]
    .filter(Boolean)
    .join(' ');

  const trigger = (
    <Button
      id={triggerId}
      type="button"
      variant="outline"
      size="sm"
      data-slot="dropzone-trigger"
      disabled={disabled}
      // Busy is said, not set: a disabled button drops the focus to the page, and `open` already refuses meanwhile.
      aria-disabled={busy || undefined}
      className="aria-disabled:opacity-50"
      aria-describedby={describedBy || undefined}
      aria-invalid={shownError ? true : undefined}
      onClick={open}
    >
      <Upload aria-hidden="true" />
      {actionLabel ??
        (filled ? 'Remplacer' : multiple ? 'Choisir des fichiers' : 'Choisir un fichier')}
    </Button>
  );

  const status = busy && (
    <p role="status" className="flex items-center justify-center gap-2 text-sm text-soft">
      <Spinner size="sm" />
      {busyLabel}
    </p>
  );

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target for the mouse; the button inside is the keyboard's way */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the same button answers the keyboard */}
      <div
        data-slot="dropzone"
        data-state={state}
        data-drag-over={dragOver || undefined}
        data-testid={testId}
        aria-disabled={disabled || undefined}
        aria-busy={busy || undefined}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={(e) => {
          // The whole empty surface opens the picker; a control inside keeps its own click.
          if (!children && !(e.target as HTMLElement).closest(INTERACTIVE)) open();
        }}
        className={cn(
          'relative rounded-xl border-2 border-dashed border-border bg-card transition-colors',
          'has-[[data-slot=dropzone-trigger]:focus-visible]:border-primary has-[[data-slot=dropzone-trigger]:focus-visible]:ring-[3px] has-[[data-slot=dropzone-trigger]:focus-visible]:ring-primary-soft',
          children
            ? 'p-2'
            : 'flex min-h-40 flex-col items-center justify-center gap-3 p-5 text-center',
          !inert && !children && 'cursor-pointer hover:border-border-strong hover:bg-accent/60',
          dragOver && 'border-primary bg-primary-soft/60',
          shownError && !dragOver && 'border-destructive',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          accept={accept?.join(',')}
          multiple={multiple}
          disabled={inert}
          className="sr-only"
          onChange={(e) => {
            receive(e.target.files);
            e.target.value = ''; // the same file may be chosen again
          }}
        />
        {children ? (
          <>
            {children}
            {status && <div className="mt-2">{status}</div>}
          </>
        ) : (
          <>
            {filled ? (
              <div
                className={cn(
                  'flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background',
                  PREVIEW_FRAME[previewShape],
                )}
              >
                {preview}
              </div>
            ) : (
              <div className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary-strong [&_svg]:size-5">
                {icon ?? <Upload aria-hidden="true" />}
              </div>
            )}
            <div className="space-y-1">
              {busy
                ? status
                : !filled && <p className="text-sm font-medium text-body">{instruction}</p>}
              {!busy && description && (
                <p className="text-xs text-soft break-words">{description}</p>
              )}
            </div>
            {/* Kept while busy: the keyboard user who just picked a file keeps their place. */}
            {trigger}
          </>
        )}
      </div>
      {(constraints || hint) && (
        <p id={helpId} className="text-xs text-soft">
          {constraints}
          {constraints && hint ? ' · ' : null}
          {hint}
        </p>
      )}
      {shownError && (
        <HelperText id={errorId} variant="error">
          {shownError}
        </HelperText>
      )}
    </div>
  );
}
