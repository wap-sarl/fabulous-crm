import { useCallback } from 'react';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuthMutation } from '@crm/widgets';
import { base64ToBlob, parseClaudeDesignBundle, rewriteAssetSrcs } from '../lib/claudeDesign';

/** The `readFile` of the HTML dropzone in Claude Design mode: the inner e-mail, its images uploaded and registered, the `<img src>` rewritten to their hosted URLs; the ids go to `onImages` so the campaign can claim them. */
export function useClaudeDesignImport(
  onImages: (ids: Id<'emailImages'>[]) => void,
): (file: File) => Promise<string> {
  const uploadUrl = useAuthMutation(api.features.attachments.mutations.generateEmailImageUploadUrl);
  const register = useAuthMutation(api.features.attachments.mutations.registerEmailImage);
  return useCallback(
    async (file: File) => {
      const bundle = parseClaudeDesignBundle(await file.text());
      if (!bundle) {
        throw new Error('Ce fichier n’est pas un export « standalone » de Claude Design.');
      }
      const urlById: Record<string, string> = {};
      const ids: Id<'emailImages'>[] = [];
      for (const asset of bundle.assets) {
        const response = await fetch(await uploadUrl({}), {
          method: 'POST',
          headers: { 'Content-Type': asset.mime },
          body: base64ToBlob(asset.data, asset.mime),
        });
        if (!response.ok) throw new Error(`Envoi de l’image ${asset.id} impossible.`);
        const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
        const registered = await register({ storageId, contentType: asset.mime });
        if (!registered.ok) {
          throw new Error(
            registered.code === 'type'
              ? `Image ${asset.id} : PNG, JPEG, GIF ou WebP attendu.`
              : `Image ${asset.id} : plus de 5 Mo.`,
          );
        }
        urlById[asset.id] = registered.url;
        ids.push(registered.imageId);
      }
      onImages(ids);
      return rewriteAssetSrcs(bundle.html, urlById);
    },
    [uploadUrl, register, onImages],
  );
}
