import { describe, expect, it } from 'bun:test';
import {
  EMAIL_UNSUB_FOOTER_HTML,
  SMS_STOP_LINE,
  withEmailCompliance,
  withSmsCompliance,
} from '../../src/features/campaigns/lib/marketingCompliance';

describe('withSmsCompliance', () => {
  it('appends the STOP line, whatever the type of the message', () => {
    const out = withSmsCompliance('Bonjour {{ params.firstName }}');
    expect(out).toBe(`Bonjour {{ params.firstName }}\n\n${SMS_STOP_LINE}`);
  });

  it('is idempotent (no duplicate line)', () => {
    const once = withSmsCompliance('Coucou');
    const twice = withSmsCompliance(once);
    expect(twice).toBe(once);
    expect(twice.match(/STOP au/g)).toHaveLength(1);
  });

  it('uses the line alone when the body is empty', () => {
    expect(withSmsCompliance('')).toBe(SMS_STOP_LINE);
  });

  it('keeps a STOP line the author moved elsewhere', () => {
    const body = `${SMS_STOP_LINE} - Votre rendez-vous est confirmé`;
    expect(withSmsCompliance(body)).toBe(body);
  });

  it('replaces a legacy consent-link STOP line by the code', () => {
    expect(withSmsCompliance('Rappel RDV\n\nSTOP : {{ params.consentUrl }}')).toBe(
      `Rappel RDV\n\n${SMS_STOP_LINE}`,
    );
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

  it('does not re-append when the author already linked the consent page', () => {
    const body = '<p>Se désinscrire : <a href="{{ params.consentUrl }}">ici</a></p>';
    expect(withEmailCompliance(body, 'marketing')).toBe(body);
  });
});
