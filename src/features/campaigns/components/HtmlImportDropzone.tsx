import { useState } from 'react';
import { FileCode } from 'lucide-react';
import { Dropzone } from '@crm/design-system';
import { HTML_BODY_MAX_BYTES } from '@crm/lib/backend';

interface Props {
  /** Called with the HTML once a valid `.html` file is loaded. */
  onLoad: (html: string) => void;
  /** Turns the file into the HTML handed to `onLoad`; the raw text by default. */
  readFile?: (file: File) => Promise<string>;
  /** The ceiling on the dropped file; the inline-body limit by default. */
  maxBytes?: number;
  busyLabel?: string;
  /** A recommendation shown under the zone, after the formats and the ceiling. */
  hint?: string;
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
  hint,
  fileName,
  onFileNameChange,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      onLoad(await readFile(file));
      onFileNameChange(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lecture du fichier impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dropzone
      accept={['.html', '.htm']}
      maxBytes={maxBytes}
      icon={<FileCode aria-hidden="true" />}
      instruction="Glissez votre fichier HTML ici ou choisissez un fichier"
      actionLabel={fileName ? 'Remplacer' : undefined}
      description={
        fileName ? (
          <>
            Fichier : <span className="font-mono">{fileName}</span>
          </>
        ) : null
      }
      hint={hint}
      error={error}
      busy={busy}
      busyLabel={busyLabel}
      onFiles={([file]) => file && void loadFile(file)}
    />
  );
}
