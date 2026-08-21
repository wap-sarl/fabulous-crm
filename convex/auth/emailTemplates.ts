/**
 * Pure (non-`'use node'`) email templates for the auth flow: the magic-link
 * login email.
 *
 * Extracted from `auth/actions.ts` so the HTML generators can be imported by
 * standalone tooling without pulling in the Convex action runtime. No business
 * logic lives here — only presentation.
 */

const BRAND_COLORS = {
  primary: '#2dd4bf',
  secondary: '#003C55',
};

export interface EmailContent {
  subject: string;
  title: string;
  intro: string;
  cta: string;
  disclaimer: string;
  /** Optional security note rendered above the disclaimer (e.g. link expiry). */
  expiryNote?: string;
}

export interface AccentColors {
  headerBg: string;
  ctaBg: string;
  ctaShadow: string;
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

export const LOGIN_ACCENT: AccentColors = {
  headerBg: BRAND_COLORS.secondary,
  ctaBg: BRAND_COLORS.primary,
  ctaShadow: 'rgba(45, 212, 191, 0.4)',
};

export function generateEmailHtml(
  magicLink: string,
  content: EmailContent,
  accent: AccentColors,
): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f0fdfa;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: ${accent.headerBg}; padding: 40px 40px 30px; border-radius: 16px 16px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                ${content.title}
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: ${BRAND_COLORS.secondary}; font-size: 16px; line-height: 1.6;">
                Bonjour,
              </p>
              <p style="margin: 0 0 30px; color: #374151; font-size: 16px; line-height: 1.6;">
                ${content.intro}
              </p>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${magicLink}"
                       style="display: inline-block; background-color: ${accent.ctaBg}; color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 14px ${accent.ctaShadow};">
                      ${content.cta}
                    </a>
                  </td>
                </tr>
              </table>

              ${
                content.expiryNote
                  ? `<p style="margin: 30px 0 10px; color: #6b7280; font-size: 14px; line-height: 1.6;">
                ${content.expiryNote}
              </p>`
                  : ''
              }
              <p style="margin: ${content.expiryNote ? '0' : '30px 0 0'}; color: #6b7280; font-size: 14px; line-height: 1.6;">
                ${content.disclaimer}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
