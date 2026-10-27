import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Dropzone } from '@crm/design-system';
import { numberFormat } from '@crm/lib/format';
import type { EntityImportSpec } from '../lib/registry';

/** Where the file is dropped or browsed for; once read, its name and its number of rows. */
export function FileDropZone({
  loadFile,
  fileName,
  parsed,
  spec,
}: {
  loadFile: (file: File) => Promise<void>;
  fileName: string | null;
  parsed: string[][];
  spec: Pick<EntityImportSpec, 'sample'>;
}) {
  const [reading, setReading] = useState(false);
  const read = async (file: File) => {
    setReading(true);
    try {
      await loadFile(file);
    } finally {
      setReading(false);
    }
  };

  return (
    <Dropzone
      accept={['.csv', '.xlsx', '.txt']}
      icon={<FileSpreadsheet aria-hidden="true" />}
      instruction="Glissez votre fichier CSV ou Excel ici ou choisissez un fichier"
      actionLabel={fileName ? 'Remplacer' : undefined}
      description={
        fileName ? (
          <>
            <span className="font-mono">{fileName}</span> · {numberFormat.format(parsed.length - 1)}{' '}
            ligne(s)
          </>
        ) : (
          <>
            La première ligne contient les en-têtes, par exemple{' '}
            <span className="font-mono">{spec.sample}</span>.
          </>
        )
      }
      busy={reading}
      busyLabel="Lecture du fichier…"
      onFiles={([file]) => file && void read(file)}
    />
  );
}
