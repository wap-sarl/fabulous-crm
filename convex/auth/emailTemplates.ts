import { EMAIL_FONT, EMAIL_PALETTE, accentOf, readableOn } from '../lib/email/palette';

/** Kept free of `'use node'` and of business logic, so standalone tooling (the Storybook previews, the tests) can import the templates without the Convex action runtime. */

/** How the deployment presents itself in a system e-mail; `emailBrandOf` (lib/email/brand.ts) reads it from the config. */
export interface EmailBrand {
  organizationName: string;
  /** Shown 32px high above the card; without one the organisation's name stands as a wordmark. */
  logoUrl?: string | null;
  /** The `#rrggbb` accent of the branding settings; absent or malformed, the theme's default. */
  primaryColor?: string | null;
  /** The app's origin, without a trailing slash: named in the footer. */
  appUrl: string;
}

export interface EmailContent {
  subject: string;
  title: string;
  intro: string;
  /** The button's label; the button needs a link too. */
  cta?: string;
  disclaimer: string;
  /** Optional security note rendered above the disclaimer (e.g. link expiry). */
  expiryNote?: string;
}

export const LOGIN_EMAIL: EmailContent = {
  subject: '[CRM] Votre lien de connexion',
  title: 'Connexion à votre espace CRM',
  intro: 'Cliquez sur le bouton ci-dessous pour accéder à votre espace CRM.',
  cta: 'Se connecter',
  disclaimer: "Si vous n'avez pas demandé ce lien, vous pouvez ignorer cet e-mail.",
  expiryNote: 'Ce lien expire dans <strong>15 minutes</strong> pour des raisons de sécurité.',
};

export const INVITE_EMAIL: EmailContent = {
  subject: '[CRM] Vous êtes invité·e à rejoindre l’espace CRM',
  title: 'Invitation à l’espace CRM',
  intro:
    'Vous avez été invité·e à rejoindre l’espace CRM. Cliquez sur le bouton ci-dessous, puis connectez-vous avec cette adresse e-mail pour activer votre accès.',
  cta: 'Rejoindre l’espace CRM',
  disclaimer: 'Si vous ne vous attendiez pas à cette invitation, vous pouvez ignorer cet e-mail.',
};

export const TEST_EMAIL: EmailContent = {
  subject: '[CRM] E-mail de test',
  title: 'E-mail de test',
  intro:
    'Cet e-mail a été envoyé depuis les paramètres du CRM pour vérifier l’envoi. Si vous le lisez, la configuration fonctionne.',
  disclaimer: 'Aucune action n’est attendue de votre part.',
};

/** For text and attribute values alike: the organisation's name and the URLs come from the configuration, not from the template. */
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * One layout for every system e-mail: the organisation above a white card on the app's grey, the card edged in the accent, title, message, one button, the security notes under a rule, the organisation and its address in the footer.
 * Tables and inline styles only, with the Outlook width fallback; the accent edge and the wordmark need no image, so the mail reads with images off.
 */
export function generateEmailHtml(content: EmailContent, brand: EmailBrand, link?: string): string {
  const accent = accentOf(brand.primaryColor);
  const name = escapeHtml(brand.organizationName);
  const href = link ? escapeHtml(link) : null;
  const mark = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="32" style="display: block; height: 32px; width: auto; max-width: 240px; border: 0; font-family: ${EMAIL_FONT}; font-size: 17px; font-weight: 700; color: ${EMAIL_PALETTE.ink};">`
    : `<span style="font-family: ${EMAIL_FONT}; font-size: 17px; line-height: 32px; font-weight: 700; letter-spacing: -0.01em; color: ${EMAIL_PALETTE.ink};">${name}</span>`;
  const button =
    content.cta && href
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate; margin: 0 0 20px;">
                <tr>
                  <td align="center" bgcolor="${accent}" style="border-radius: 8px; background-color: ${accent}; mso-padding-alt: 13px 24px;">
                    <a href="${href}" style="display: inline-block; padding: 13px 24px; font-family: ${EMAIL_FONT}; font-size: 15px; line-height: 20px; font-weight: 600; color: ${readableOn(accent)}; text-decoration: none; border-radius: 8px;">${content.cta}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 12px; line-height: 18px; color: ${EMAIL_PALETTE.faint};">
                Si le bouton ne s’ouvre pas, copiez ce lien dans votre navigateur :<br>
                <a href="${href}" style="color: ${EMAIL_PALETTE.soft}; word-break: break-all;">${href}</a>
              </p>`
      : '';
  const notes = [content.expiryNote, content.disclaimer]
    .filter((note): note is string => Boolean(note))
    .map(
      (note) =>
        `<p style="margin: 0 0 8px; font-size: 13px; line-height: 20px; color: ${EMAIL_PALETTE.soft};">${note}</p>`,
    )
    .join('\n              ');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${content.title}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .outer { padding: 20px 12px !important; }
      .card { padding: 28px 22px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${EMAIL_PALETTE.canvas}; word-break: break-word;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${content.intro}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; background-color: ${EMAIL_PALETTE.canvas};">
    <tr>
      <td align="center" class="outer" style="padding: 40px 16px;">
        <!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate; width: 100%; max-width: 560px; margin: 0 auto;">
          <tr>
            <td style="padding: 0 4px 18px;">${mark}</td>
          </tr>
          <tr>
            <td style="padding: 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate; width: 100%; background-color: ${EMAIL_PALETTE.card}; border: 1px solid ${EMAIL_PALETTE.border}; border-radius: 12px;">
                <tr>
                  <td height="4" bgcolor="${accent}" style="height: 4px; line-height: 4px; font-size: 4px; background-color: ${accent}; border-radius: 11px 11px 0 0;">&nbsp;</td>
                </tr>
                <tr>
                  <td class="card" style="padding: 32px 40px; font-family: ${EMAIL_FONT};">
              <h1 style="margin: 0 0 16px; font-size: 22px; line-height: 28px; font-weight: 700; letter-spacing: -0.01em; color: ${EMAIL_PALETTE.ink};">${content.title}</h1>
              <p style="margin: 0 0 12px; font-size: 15px; line-height: 24px; color: ${EMAIL_PALETTE.body};">Bonjour,</p>
              <p style="margin: 0 0 28px; font-size: 15px; line-height: 24px; color: ${EMAIL_PALETTE.body};">${content.intro}</p>
              ${button}
              <div style="margin: 28px 0 20px; border-top: 1px solid ${EMAIL_PALETTE.border};"></div>
              ${notes}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 4px 0; font-family: ${EMAIL_FONT}; font-size: 12px; line-height: 18px; color: ${EMAIL_PALETTE.faint};">
              ${name} · <a href="${escapeHtml(brand.appUrl)}" style="color: ${EMAIL_PALETTE.faint}; text-decoration: underline;">${escapeHtml(hostOf(brand.appUrl))}</a>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}
