import { describe, expect, test } from 'bun:test';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import {
  type EmailBrand,
  INVITE_EMAIL,
  LOGIN_EMAIL,
  TEST_EMAIL,
  generateEmailHtml,
  subjectOf,
} from '../../convex/auth/emailTemplates';
import { emailBrandOf } from '../../convex/lib/email/brand';
import { EMAIL_PALETTE, accentOf, contrastOf, readableOn } from '../../convex/lib/email/palette';

const BRAND: EmailBrand = {
  organizationName: 'Clinique Nord',
  logo: { url: 'https://files.example.com/logo.png', width: 600, height: 120 },
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
      '<img src="https://files.example.com/logo.png" alt="Clinique Nord" height="32" width="160"',
    );
    expect(html).toContain('Clinique Nord · <a href="https://crm.example.com"');
    expect(html).toContain('>crm.example.com</a>');
  });

  test('the logo’s attributes follow its proportions, 32 px high, 240 px wide at most; unknown, the height alone', () => {
    const attrs = (logo: EmailBrand['logo']) =>
      /<img [^>]*?(height="\d+"(?: width="\d+")?)/.exec(
        generateEmailHtml(LOGIN_EMAIL, { ...BRAND, logo }, LINK),
      )?.[1];
    expect(attrs({ url: 'x', width: 2400, height: 200 })).toBe('height="20" width="240"');
    expect(attrs({ url: 'x', width: 64, height: 64 })).toBe('height="32" width="32"');
    expect(attrs({ url: 'x' })).toBe('height="32"');
  });

  test('without a logo the organisation’s name stands as the wordmark', () => {
    const html = generateEmailHtml(LOGIN_EMAIL, { ...BRAND, logo: null }, LINK);
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

  test('the button’s text reads on its accent: white on a dark one, black on a light one, 4.5:1 at least whatever the accent', () => {
    expect(readableOn('#003c55')).toBe('#ffffff');
    expect(readableOn(EMAIL_PALETTE.primary)).toBe('#ffffff');
    expect(readableOn('#facc15')).toBe('#000000');
    // Every colour of a 6-step cube, the mid-tones included, where neither white nor ink would do.
    const steps = ['00', '33', '66', '99', 'cc', 'ff'];
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const accent = `#${r}${g}${b}`;
          expect(contrastOf(accent, readableOn(accent))).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    expect(generateEmailHtml(LOGIN_EMAIL, { ...BRAND, primaryColor: '#facc15' }, LINK)).toContain(
      'color: #000000; text-decoration: none;',
    );
    expect(accentOf('#ABCDEF')).toBe('#abcdef');
  });

  test('the subject names the organisation, as the body does', () => {
    expect(subjectOf(LOGIN_EMAIL, BRAND)).toBe('[Clinique Nord] Votre lien de connexion');
    expect(subjectOf(TEST_EMAIL, { ...BRAND, organizationName: 'CRM' })).toBe(
      '[CRM] E-mail de test',
    );
  });

  test('what comes from the configuration is escaped', () => {
    const html = generateEmailHtml(
      LOGIN_EMAIL,
      { ...BRAND, organizationName: 'Dupont & <Fils> "SA"', logo: null },
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

describe('the brand read from the configuration', () => {
  const storageId = 'kg2logo' as Id<'_storage'>;
  const ctx = {
    storage: { getUrl: async (id: Id<'_storage'>) => `https://files.example.com/${id}` },
  } as never;
  const cfg = (logoImage?: Doc<'appConfig'>['logoImage']) =>
    ({
      organizationName: 'Clinique Nord',
      appUrl: 'https://crm.example.com/',
      primaryColor: '#003c55',
      logoStorageId: storageId,
      logoImage,
    }) as Doc<'appConfig'>;

  test('a PNG, JPEG or GIF logo goes in the mail with its proportions', async () => {
    const brand = await emailBrandOf(
      ctx,
      cfg({ contentType: 'image/png', width: 600, height: 120 }),
    );
    expect(brand).toEqual({
      organizationName: 'Clinique Nord',
      logo: { url: `https://files.example.com/${storageId}`, width: 600, height: 120 },
      primaryColor: '#003c55',
      appUrl: 'https://crm.example.com',
    });
    expect((await emailBrandOf(ctx, cfg({ contentType: 'image/jpeg' }))).logo).toEqual({
      url: `https://files.example.com/${storageId}`,
      width: undefined,
      height: undefined,
    });
  });

  test('an SVG or WebP logo, which Gmail and Outlook do not display, leaves the wordmark; so does a logo whose type was never recorded', async () => {
    for (const image of [
      { contentType: 'image/svg+xml', width: 160, height: 32 },
      { contentType: 'image/webp', width: 160, height: 32 },
      undefined,
    ]) {
      expect((await emailBrandOf(ctx, cfg(image))).logo).toBeNull();
    }
  });

  test('no configuration at all: the CRM by its name, the origin of the deployment', async () => {
    const brand = await emailBrandOf(ctx, null);
    expect(brand.organizationName).toBe('CRM');
    expect(brand.logo).toBeNull();
    expect(brand.primaryColor).toBeNull();
  });
});
