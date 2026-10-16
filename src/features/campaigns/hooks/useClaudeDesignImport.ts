import { useCallback } from 'react';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuthMutation } from '@crm/widgets';
import { base64ToBlob, parseClaudeDesignBundle, rewriteAssetSrcs } from '../lib/claudeDesign';

/** The `readFile` of the HTML dropzone in Claude Design mode: the inner e-mail, its images uploaded to the file storage and the `<img src>` rewritten to their hosted URLs, so the body stays small. */
export function useClaudeDesignImport(): (file: File) => Promise<string> {
  const uploadUrl = useAuthMutation(api.features.attachments.mutations.generateEmailImageUploadUrl);
  const resolveUrls = useAuthMutation(api.features.attachments.mutations.resolveEmailImageUrls);
  return useCallback(
    async (file: File) => {
      const bundle = parseClaudeDesignBundle(await file.text());
      if (!bundle) {
        throw new Error('Ce fichier n’est pas un export « standalone » de Claude Design.');
      }
      const storageIds: Id<'_storage'>[] = [];
      for (const asset of bundle.assets) {
        const response = await fetch(await uploadUrl({}), {
          method: 'POST',
          headers: { 'Content-Type': asset.mime },
          body: base64ToBlob(asset.data, asset.mime),
        });
        if (!response.ok) throw new Error(`Envoi de l’image ${asset.id} impossible.`);
        storageIds.push(((await response.json()) as { storageId: Id<'_storage'> }).storageId);
      }
      const urls = await resolveUrls({ storageIds });
      const urlById: Record<string, string> = {};
      bundle.assets.forEach((asset, i) => {
        const url = urls[i];
        if (url) urlById[asset.id] = url;
      });
      return rewriteAssetSrcs(bundle.html, urlById);
    },
    [uploadUrl, resolveUrls],
  );
}
