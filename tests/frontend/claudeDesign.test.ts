import { describe, expect, test } from 'bun:test';
import {
  parseClaudeDesignBundle,
  rewriteAssetSrcs,
} from '../../src/features/campaigns/lib/claudeDesign';

const png = 'iVBORw0KGgo=';
const html = '<html><body><img src="a1"><img src="b2"><img src="https://x/c.png"></body></html>';
const bundle = `<!DOCTYPE html><html><head></head><body>
<script type="__bundler/manifest">
  ${JSON.stringify({ a1: { mime: 'image/png', compressed: false, data: png }, b2: { mime: 'image/webp', compressed: false, data: png } })}
</script>
<script type="__bundler/template">
  ${JSON.stringify(html)}
</script>
</body></html>`;

describe('a Claude Design export', () => {
  test('gives its inner e-mail and its images', () => {
    const parsed = parseClaudeDesignBundle(bundle);
    expect(parsed?.html).toBe(html);
    expect(parsed?.assets).toEqual([
      { id: 'a1', mime: 'image/png', data: png },
      { id: 'b2', mime: 'image/webp', data: png },
    ]);
  });

  test('a plain HTML file is not one', () => {
    expect(parseClaudeDesignBundle('<html><body>hi</body></html>')).toBeNull();
  });

  test('a compressed image is refused', () => {
    const compressed = bundle.replace('"compressed":false', '"compressed":true');
    expect(() => parseClaudeDesignBundle(compressed)).toThrow(/compress/);
  });

  test('the asset ids become the hosted URLs, other sources stay', () => {
    expect(rewriteAssetSrcs(html, { a1: 'https://x/a.png', b2: 'https://x/b.webp' })).toBe(
      '<html><body><img src="https://x/a.png"><img src="https://x/b.webp"><img src="https://x/c.png"></body></html>',
    );
  });
});
