/** A Claude Design « standalone » export is not an e-mail: the real one is a JSON string in `<script type="__bundler/template">`, its `<img src="<id>">` point into the base64 manifest of `<script type="__bundler/manifest">`. */
interface ClaudeDesignAsset {
  id: string;
  mime: string;
  data: string;
}

export interface ClaudeDesignBundle {
  html: string;
  assets: ClaudeDesignAsset[];
}

function scriptBlock(text: string, type: string): string | null {
  const m = new RegExp(`<script type="__bundler/${type}">([\\s\\S]*?)</script>`).exec(text);
  return m ? m[1].trim() : null;
}

/** `null` for a file without the two blocks: a plain HTML export. */
export function parseClaudeDesignBundle(text: string): ClaudeDesignBundle | null {
  const template = scriptBlock(text, 'template');
  const manifest = scriptBlock(text, 'manifest');
  if (template === null || manifest === null) return null;
  const html = JSON.parse(template) as string;
  const entries = JSON.parse(manifest) as Record<
    string,
    { mime: string; compressed?: boolean; data: string }
  >;
  const assets = Object.entries(entries).map(([id, a]) => {
    // No export seen so far carries a compressed asset; a decoder comes when one does.
    if (a.compressed) throw new Error(`Image ${id} : format compressé non pris en charge.`);
    return { id, mime: a.mime, data: a.data };
  });
  return { html, assets };
}

/** The bare asset ids of the `src` attributes become the hosted URLs; any other `src` is left alone. */
export function rewriteAssetSrcs(html: string, urlById: Record<string, string>): string {
  return html.replace(/src="([^"]+)"/g, (full, id: string) =>
    id in urlById ? `src="${urlById[id]}"` : full,
  );
}

export function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
