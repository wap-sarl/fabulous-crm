import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, toast, cn } from '@crm/design-system';

/** MIME types browsers report for a `.html`/`.htm` file (some report none). */
const HTML_MIME = new Set(['text/html', 'application/xhtml+xml', 'text/plain', '']);

interface Props {
  /** Called with the file's raw text once a valid `.html` file is loaded. */
  onLoad: (html: string) => void;
  /** Name of the currently loaded file, shown as confirmation. */
  fileName: string | null;
  onFileNameChange: (name: string) => void;
}

/**
 * Drag-and-drop (or browse) an `.html` file and read it client-side via
 * `file.text()`. Mirrors the CSV importer's dropzone; the loaded HTML is handed
 * back verbatim so a designer-made template keeps full fidelity.
 */
export function HtmlImportDropzone({ onLoad, fileName, onFileNameChange }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFile = async (file: File) => {
    const name = file.name.toLowerCase();
    const isHtml = name.endsWith('.html') || name.endsWith('.htm') || HTML_MIME.has(file.type);
    if (!isHtml) {
      toast.error('Veuillez sélectionner un fichier .html');
      return;
    }
    const text = await file.text();
    onLoad(text);
    onFileNameChange(file.name);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
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
    if (file) void loadFile(file);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 text-center transition-colors',
        isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
      )}
    >
      <Upload className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Glissez un fichier HTML ici ou</p>
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        Parcourir
      </Button>
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
