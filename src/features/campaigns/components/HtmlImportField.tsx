import { Label } from '@crm/design-system';
import { useClaudeDesignImport } from '../hooks/useClaudeDesignImport';
import { HtmlImportDropzone } from './HtmlImportDropzone';

/** A Claude Design standalone export embeds every image as base64: 50 MiB covers a heavy one. */
const CLAUDE_DESIGN_MAX_BYTES = 50 * 1024 * 1024;

/** The HTML of an e-mail from a file: a plain template sent as it is, or a Claude Design export whose images the CRM hosts. */
export function HtmlImportField({
  claudeDesign,
  onLoad,
  fileName,
  onFileNameChange,
  tokens,
}: {
  claudeDesign: boolean;
  onLoad: (html: string) => void;
  fileName: string | null;
  onFileNameChange: (name: string) => void;
  tokens: string[];
}) {
  const importClaudeDesign = useClaudeDesignImport();
  return (
    <>
      <Label>{claudeDesign ? 'Export Claude Design' : 'Modèle HTML'}</Label>
      {claudeDesign ? (
        <HtmlImportDropzone
          onLoad={onLoad}
          readFile={importClaudeDesign}
          maxBytes={CLAUDE_DESIGN_MAX_BYTES}
          busyLabel="Envoi des images…"
          fileName={fileName}
          onFileNameChange={onFileNameChange}
        />
      ) : (
        <HtmlImportDropzone
          onLoad={onLoad}
          fileName={fileName}
          onFileNameChange={onFileNameChange}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {claudeDesign
          ? 'Export « standalone » (.html) de Claude Design : les images sont hébergées par le CRM, le reste est envoyé tel quel. '
          : 'Le fichier est envoyé tel quel. '}
        Insérez les champs dans votre HTML : {tokens.join(', ')}.
      </p>
    </>
  );
}
