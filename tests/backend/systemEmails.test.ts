import { describe, expect, test } from 'bun:test';
import {
  type EmailBrand,
  INVITE_EMAIL,
  LOGIN_EMAIL,
  TEST_EMAIL,
  generateEmailHtml,
} from '../../convex/auth/emailTemplates';
import { EMAIL_PALETTE, accentOf, contrastOf, readableOn } from '../../convex/lib/email/palette';

const BRAND: EmailBrand = {
  organizationName: 'Clinique Nord',
  logoUrl: 'https://files.example.com/logo.png',
  primaryColor: '#003c55',
  appUrl: 'https://crm.example.com',
};
const LINK = 'https://crm.example.com/auth/continue?email=a%40b.fr&otp=123456';

describe('the system e-mails', () => {
  test('the sign-in mail carries its link in the button and in clear, and keeps the security notes', () => {
    const html = generateEmailHtml(LOGIN_EMAIL, BRAND, LINK);
    const escaped = LINK.replace(/&/g, '&amp;');
    expect(html.split(`href="${escaped}"`)).toHaveLength(3);
    expect(html).toContain(`>${escaped}</a>`);
    expect(html).toContain('Se connecter');
    expect(html).toContain('<strong>15 minutes</strong>');
    expect(html).toContain(LOGIN_EMAIL.disclaimer);
    expect(html).toContain(`<title>${LOGIN_EMAIL.title}</title>`);
  });

  test('the organisation is shown by its logo, named in its alt text, and named again in the footer with the app’s host', () => {
    const html = generateEmailHtml(LOGIN_EMAIL, BRAND, LINK);
    expect(html).toContain(
      '<img src="https://files.example.com/logo.png" alt="Clinique Nord" height="32"',
    );
    expect(html).toContain('Clinique Nord · <a href="https://crm.example.com"');
    expect(html).toContain('>crm.example.com</a>');
  });

  test('without a logo the organisation’s name stands as the wordmark', () => {
    const html = generateEmailHtml(LOGIN_EMAIL, { ...BRAND, logoUrl: null }, LINK);
    expect(html).not.toContain('<img');
    expect(html).toMatch(/<span[^>]*font-weight: 700[^>]*>Clinique Nord<\/span>/);
  });

  test('the configured accent edges the card and fills the button; the theme’s violet when none is set', () => {
    const branded = generateEmailHtml(LOGIN_EMAIL, BRAND, LINK);
    expect(branded).toContain('<td height="4" bgcolor="#003c55"');
    const plain = generateEmailHtml(LOGIN_EMAIL, { ...BRAND, primaryColor: null }, LINK);
    expect(plain).toContain(`bgcolor="${EMAIL_PALETTE.primary}"`);
    expect(generateEmailHtml(LOGIN_EMAIL, { ...BRAND, primaryColor: 'teal' }, LINK)).toContain(
      `bgcolor="${EMAIL_PALETTE.primary}"`,
    );
  });

  test('the button’s text reads on its accent: white on a dark one, ink on a light one, 4.5:1 at least either way', () => {
    expect(readableOn('#003c55')).toBe('#ffffff');
    expect(readableOn(EMAIL_PALETTE.primary)).toBe('#ffffff');
    expect(readableOn('#facc15')).toBe(EMAIL_PALETTE.ink);
    for (const accent of ['#003c55', EMAIL_PALETTE.primary, '#facc15', '#2dd4bf']) {
      expect(contrastOf(accent, readableOn(accent))).toBeGreaterThanOrEqual(4.5);
    }
    expect(generateEmailHtml(LOGIN_EMAIL, { ...BRAND, primaryColor: '#facc15' }, LINK)).toContain(
      `color: ${EMAIL_PALETTE.ink}; text-decoration: none;`,
    );
    expect(accentOf('#ABCDEF')).toBe('#abcdef');
  });

  test('what comes from the configuration is escaped', () => {
    const html = generateEmailHtml(
      LOGIN_EMAIL,
      { ...BRAND, organizationName: 'Dupont & <Fils> "SA"', logoUrl: null },
      'https://crm.example.com/?a=1&b="x"',
    );
    expect(html).toContain('Dupont &amp; &lt;Fils&gt; &quot;SA&quot;');
    expect(html).not.toContain('<Fils>');
    expect(html).toContain('href="https://crm.example.com/?a=1&amp;b=&quot;x&quot;"');
  });

  test('the invitation points at the app; the test mail has no button and says what it is', () => {
    const invite = generateEmailHtml(INVITE_EMAIL, BRAND, BRAND.appUrl);
    expect(invite).toContain('href="https://crm.example.com"');
    expect(invite).toContain('Rejoindre l’espace CRM');
    expect(invite).not.toContain('15 minutes');
    const test = generateEmailHtml(TEST_EMAIL, BRAND);
    expect(test).toContain('<h1');
    expect(test).toContain('E-mail de test');
    expect(test).not.toContain('mso-padding-alt');
    expect(test).not.toContain('copiez ce lien');
    expect(test).toContain(TEST_EMAIL.disclaimer);
  });

  test('the layout is tables and inline styles, with the Outlook width fallback and the phone rule', () => {
    const html = generateEmailHtml(LOGIN_EMAIL, BRAND, LINK);
    expect(html).toStartWith('<!DOCTYPE html>');
    expect(html).toContain('<!--[if mso]><table role="presentation" width="560"');
    expect(html).toContain('max-width: 560px');
    expect(html).toContain('@media only screen and (max-width: 480px)');
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
  });
});
