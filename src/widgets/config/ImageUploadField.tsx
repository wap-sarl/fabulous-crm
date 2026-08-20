import { useId, useRef, useState } from 'react';
import { Button, Label, Spinner, toast } from '@crm/design-system';
import type { Id } from '@crm/lib/backend';
import { ImageIcon, Upload } from 'lucide-react';

const DEFAULT_ACCEPT = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];
const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MB

export interface ImageUploadFieldProps {
  label: string;
  /** Human hint under the field (e.g. recommended format/size). */
  hint?: string;
  /** Currently stored asset URL, shown as the initial preview. */
  currentUrl?: string | null;
  /** Accepted MIME types. Defaults to PNG/SVG/JPEG/WebP. */
  accept?: string[];
  /** Max file size in bytes. Defaults to 1 MB. */
  maxBytes?: number;
  /** Returns a fresh Convex upload URL (setup-token or admin mutation). */
  onGetUploadUrl: () => Promise<string>;
  /**
   * Called once the POST succeeds, with the uploaded storage id and a local
   * object-URL for the file (usable as a preview until the page reloads).
   */
  onUploaded: (storageId: Id<'_storage'>, previewUrl: string) => void;
  /** Preview shape: 'square' (favicon) or 'wide' (logo). */
  shape?: 'square' | 'wide';
}

/**
 * File upload for a branding asset. Uses Convex's two-step upload: fetch a
 * short-lived upload URL, POST the file, then hand the returned `storageId`
 * back to the caller. Shows an instant local preview via an object URL and a
 * spinner while the upload is in flight. Shared by the setup wizard (pre-auth,
 * setup-token URL) and the admin settings screen (admin URL).
 */
export function ImageUploadField({
  label,
  hint,
  currentUrl,
  accept = DEFAULT_ACCEPT,
  maxBytes = DEFAULT_MAX_BYTES,
  onGetUploadUrl,
  onUploaded,
  shape = 'square',
}: ImageUploadFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!accept.includes(file.type)) {
      toast.error('Format non pris en charge.');
      return;
    }
    if (file.size > maxBytes) {
      toast.error(`Fichier trop volumineux (max ${Math.round(maxBytes / 1024)} Ko).`);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setUploading(true);
    try {
      const uploadUrl = await onGetUploadUrl();
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`upload_failed_${res.status}`);
      const { storageId } = (await res.json()) as { storageId: Id<'_storage'> };
      // Swap the preview to the new object URL only after a successful upload.
      setPreview((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return objectUrl;
      });
      onUploaded(storageId, objectUrl);
    } catch {
      URL.revokeObjectURL(objectUrl);
      toast.error("L'envoi du fichier a échoué.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex items-center gap-4">
        <div
          className={`flex ${shape === 'square' ? 'size-16' : 'h-16 w-28'} shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-canvas`}
        >
          {uploading ? (
            <Spinner size="sm" />
          ) : preview ? (
            <img src={preview} alt="" className="size-full object-contain" />
          ) : (
            <ImageIcon className="size-6 text-placeholder" aria-hidden="true" />
          )}
        </div>
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="mr-2 size-4" aria-hidden="true" />
            {preview ? 'Remplacer' : 'Choisir un fichier'}
          </Button>
          {hint && <p className="text-xs text-faint">{hint}</p>}
        </div>
      </div>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />
    </div>
  );
}
