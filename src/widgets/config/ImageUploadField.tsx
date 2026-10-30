import { useId, useState } from 'react';
import { Dropzone, Label } from '@crm/design-system';
import type { Id } from '@crm/lib/backend';
import { ImageIcon } from 'lucide-react';

const DEFAULT_ACCEPT = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];
const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MB

/** What the browser knows of an uploaded image: the type it sent, the intrinsic size when the image has one (an SVG may not). */
export interface UploadedImage {
  contentType: string;
  width?: number;
  height?: number;
}

/** The intrinsic size, from the browser's own decoding; nothing for an image it cannot size. */
const sizeOf = (url: string) =>
  new Promise<Pick<UploadedImage, 'width' | 'height'>>((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve(
        image.naturalWidth && image.naturalHeight
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : {},
      );
    image.onerror = () => resolve({});
    image.src = url;
  });

export interface ImageUploadFieldProps {
  label: string;
  /** A recommendation the field does not check (a transparent background, a square); the formats and the ceiling are said by the zone. */
  hint?: string;
  /** Currently stored asset URL, shown as the initial preview. */
  currentUrl?: string | null;
  /** Accepted MIME types. Defaults to PNG/SVG/JPEG/WebP. */
  accept?: string[];
  /** Max file size in bytes. Defaults to 1 MB. */
  maxBytes?: number;
  /** Returns a fresh Convex upload URL (setup-token or admin mutation). */
  onGetUploadUrl: () => Promise<string>;
  /** Called once the upload succeeds; the preview is a local object URL, valid until the page reloads. */
  onUploaded: (storageId: Id<'_storage'>, previewUrl: string, image: UploadedImage) => void;
  /** Preview shape: 'square' (favicon) or 'wide' (logo). */
  shape?: 'square' | 'wide';
}

/** Convex's two-step upload: a short-lived URL, then the file; shared by the setup wizard, before sign-in, and the admin settings. */
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
  const triggerId = useId();
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setUploading(true);
    setError(null);
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
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return objectUrl;
      });
      onUploaded(storageId, objectUrl, { contentType: file.type, ...(await sizeOf(objectUrl)) });
    } catch {
      URL.revokeObjectURL(objectUrl);
      setError('L’envoi du fichier a échoué ; l’image précédente est conservée. Réessayez.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={triggerId}>{label}</Label>
      <Dropzone
        id={triggerId}
        accept={accept}
        maxBytes={maxBytes}
        icon={<ImageIcon aria-hidden="true" />}
        instruction="Glissez votre image ici ou choisissez un fichier"
        preview={preview ? <img src={preview} alt="" className="size-full object-contain" /> : null}
        previewShape={shape}
        hint={hint}
        error={error}
        busy={uploading}
        onFiles={([file]) => file && void handleFile(file)}
      />
    </div>
  );
}
