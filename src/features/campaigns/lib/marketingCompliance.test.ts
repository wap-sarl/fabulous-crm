import { describe, expect, it } from 'bun:test';
import {
  EMAIL_UNSUB_FOOTER_HTML,
  SMS_STOP_LINE,
  withEmailCompliance,
  withSmsCompliance,
} from './marketingCompliance';

describe('withSmsCompliance', () => {
  it('appends the STOP line for marketing', () => {
    const out = withSmsCompliance('Bonjour {{ params.firstName }}', 'marketing');
    expect(out).toBe(`Bonjour {{ params.firstName }}\n\n${SMS_STOP_LINE}`);
  });

  it('is idempotent for marketing (no duplicate line)', () => {
    const once = withSmsCompliance('Coucou', 'marketing');
    const twice = withSmsCompliance(once, 'marketing');
    expect(twice).toBe(once);
    expect(twice.match(/STOP :/g)).toHaveLength(1);
  });

  it('uses the line alone when the body is empty', () => {
    expect(withSmsCompliance('', 'marketing')).toBe(SMS_STOP_LINE);
  });

  it('does not re-append when the author already put a consent link', () => {
    const body = 'Stop ici {{ params.consentUrl }}';
    expect(withSmsCompliance(body, 'marketing')).toBe(body);
  });

  it('strips the STOP line for transactional', () => {
    const marketing = withSmsCompliance('Votre rendez-vous est confirmé', 'marketing');
    expect(withSmsCompliance(marketing, 'transactional')).toBe('Votre rendez-vous est confirmé');
  });
});

describe('withEmailCompliance', () => {
  it('appends the unsubscribe block for marketing', () => {
    const out = withEmailCompliance('<p>Bonjour</p>', 'marketing');
    expect(out).toBe(`<p>Bonjour</p>${EMAIL_UNSUB_FOOTER_HTML}`);
  });

  it('is idempotent for marketing', () => {
    const once = withEmailCompliance('<p>Salut</p>', 'marketing');
    const twice = withEmailCompliance(once, 'marketing');
    expect(twice).toBe(once);
    expect(twice.match(/params\.consentUrl/g)).toHaveLength(1);
  });

  it('strips the block (and its <hr>) for transactional', () => {
    const marketing = withEmailCompliance('<p>Bonjour</p>', 'marketing');
    expect(withEmailCompliance(marketing, 'transactional')).toBe('<p>Bonjour</p>');
  });

  it('strips a TipTap-normalised block with a link', () => {
    const html =
      '<p>Corps</p><hr><p>Pour vous désinscrire, ' +
      '<a href="{{ params.consentUrl }}">cliquez ici</a>.</p>';
    expect(withEmailCompliance(html, 'transactional')).toBe('<p>Corps</p>');
  });

  it('does not re-append when a consent link already exists', () => {
    const html = '<p>Voir <a href="{{ params.consentUrl }}">ici</a></p>';
    expect(withEmailCompliance(html, 'marketing')).toBe(html);
  });
});
