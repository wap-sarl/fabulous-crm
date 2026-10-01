import { Upload } from 'lucide-react';
import { Button, Progress } from '@crm/design-system';
import { numberFormat } from '@crm/lib/format';
import type { UploadProgress } from '../types';

/** The button that starts the dry run; while the rows go up, their progress takes its place. */
export function SimulateImportAction({
  upload,
  start,
}: {
  upload: UploadProgress | null;
  start: () => Promise<void>;
}) {
  return upload ? (
    <div className="space-y-1">
      <Progress value={upload.done} max={upload.total} />
      <p className="text-xs text-muted-foreground">
        Envoi des lignes… {numberFormat.format(upload.done)}/{numberFormat.format(upload.total)}
      </p>
    </div>
  ) : (
    <div className="flex justify-end">
      <Button onClick={start} data-testid="simulate-import">
        <Upload className="h-4 w-4" />
        Simuler l’import
      </Button>
    </div>
  );
}
