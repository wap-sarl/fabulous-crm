import { useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Button, cn } from '@crm/design-system';
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
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for dragged files; the button beside it is the keyboard path
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void loadFile(file);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors',
        isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
      )}
    >
      <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Glissez un fichier .csv ou .xlsx ici ou</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
      >
        Parcourir
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void loadFile(file);
          e.target.value = '';
        }}
      />
      <p className="text-xs text-muted-foreground">
        {fileName ? (
          <>
            <span className="font-mono">{fileName}</span> · {numberFormat.format(parsed.length - 1)}{' '}
            ligne(s)
          </>
        ) : (
          <>
            La première ligne contient les en-têtes, par exemple{' '}
            <span className="font-mono">{spec.sample}</span>.
          </>
        )}
      </p>
    </div>
  );
}
