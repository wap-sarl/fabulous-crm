import { describe, expect, it } from 'bun:test';
import { wrapEmailHtml } from './emailUtils';

describe('wrapEmailHtml', () => {
  it('wraps a WYSIWYG fragment in the email-safe document shell', () => {
    const out = wrapEmailHtml('<p>Bonjour</p>');
    // Exactly one shell was added, with the fragment nested inside it.
    expect(out.match(/<!doctype html>/gi)).toHaveLength(1);
    expect(out).toContain('max-width:600px');
    expect(out).toContain('<p>Bonjour</p>');
  });

  it('returns an imported full document verbatim (idempotent, not double-wrapped)', () => {
    const doc = '<!doctype html><html lang="fr"><body><h1>Salut</h1></body></html>';
    expect(wrapEmailHtml(doc)).toBe(doc);
  });

  it('detects a full document regardless of case or leading whitespace', () => {
    const upper = '<!DOCTYPE HTML><HTML><body>x</body></HTML>';
    expect(wrapEmailHtml(upper)).toBe(upper);

    const htmlOnly = '\n  <html>\n<body>y</body>\n</html>';
    expect(wrapEmailHtml(htmlOnly)).toBe(htmlOnly);
  });
});
