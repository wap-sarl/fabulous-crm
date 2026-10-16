import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, Spinner, toast, cn } from '@crm/design-system';
import { HTML_BODY_MAX_BYTES } from '@crm/lib/backend';

/** MIME types browsers report for a `.html`/`.htm` file (some report none). */
const HTML_MIME = new Set(['text/html', 'application/xhtml+xml', 'text/plain', '']);

interface Props {
  /** Called with the HTML once a valid `.html` file is loaded. */
  onLoad: (html: string) => void;
  /** Turns the file into the HTML handed to `onLoad`; the raw text by default. */
  readFile?: (file: File) => Promise<string>;
  /** The ceiling on the dropped file; the inline-body limit by default. */
  maxBytes?: number;
  busyLabel?: string;
  /** Name of the currently loaded file, shown as confirmation. */
  fileName: string | null;
  onFileNameChange: (name: string) => void;
}

/** The file is read in the browser and handed back verbatim, so a designer-made template keeps full fidelity; a reader of its own (Claude Design) hands back what it made of it. */
export function HtmlImportDropzone({
  onLoad,
  readFile = (file) => file.text(),
  maxBytes = HTML_BODY_MAX_BYTES,
  busyLabel = 'Lecture du fichier…',
  fileName,
  onFileNameChange,
}: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFile = async (file: File) => {
    const name = file.name.toLowerCase();
    const isHtml = name.endsWith('.html') || name.endsWith('.htm') || HTML_MIME.has(file.type);
    if (!isHtml) {
      toast.error('Veuillez sélectionner un fichier .html');
      return;
    }
    if (file.size > maxBytes) {
      toast.error(
        `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo, maximum ${Math.round(maxBytes / 1024)} Ko). Hébergez les images en ligne plutôt que de les intégrer dans le HTML.`,
      );
      return;
    }
    setBusy(true);
    try {
      onLoad(await readFile(file));
      onFileNameChange(file.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lecture du fichier impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && !busy) void loadFile(file);
    e.target.value = ''; // allow re-selecting the same file
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !busy) void loadFile(file);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for the mouse; the button inside is the keyboard's way
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 text-center transition-colors',
        isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
      )}
    >
      {busy ? (
        <>
          <Spinner size="sm" />
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {busyLabel}
          </p>
        </>
      ) : (
        <>
          <Upload className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Glissez un fichier HTML ici ou</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            Parcourir
          </Button>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm,text/html"
        className="hidden"
        onChange={handleFileSelect}
      />
      {fileName && (
        <p className="text-xs text-muted-foreground">
          Fichier : <span className="font-mono">{fileName}</span>
        </p>
      )}
    </div>
  );
}
