import { refusal } from '../../_lib/refusal';
import { HTML_BODY_MAX_BYTES } from '../../_lib/validators/crm';
import { follows, positiveIntSchema } from '../../_lib/validators/fields';
import {
  EMAIL_PROVIDER_REQUIRED,
  type ResolvedEmailProvider,
  isEmailProviderConfigured,
  SMS_PROVIDER_REQUIRED,
} from '../email/provider';

/** Stored inline on the campaign row, which Convex caps at 1 MiB: an HTML body past the ceiling, measured in UTF-8 bytes, is refused; embedded images must be hosted instead. */
export function assertHtmlBodySize(html: string): void {
  if (new TextEncoder().encode(html).length > HTML_BODY_MAX_BYTES) {
    throw refusal('html_body_too_large', {
      message:
        'Le contenu HTML dépasse 800 Ko. Hébergez les images en ligne plutôt que de les intégrer dans le HTML.',
    });
  }
}

export type CampaignContent = {
  brevoTemplateId?: number;
  subject?: string;
  htmlBody?: string;
  smsBody?: string;
};

/** The content of a campaign for its channel and mode, refused when the provider cannot serve it: SMS needs Brevo and a body; a custom e-mail a subject and a configured provider; a Brevo template its id, and Brevo. */
export function resolveCampaignContent(
  args: { channel: 'email' | 'sms' } & CampaignContent,
  provider: ResolvedEmailProvider,
  smsAvailable: boolean,
): CampaignContent {
  if (args.channel === 'sms') {
    // SMS is Brevo-only, independent of the email provider.
    if (!smsAvailable) throw refusal('sms_provider_required', { message: SMS_PROVIDER_REQUIRED });
    const smsBody = args.smsBody?.trim();
    if (!smsBody) throw refusal('sms_body_required', { message: 'Le message SMS est requis.' });
    return { smsBody };
  }
  // Without a usable provider (Brevo key or SMTP host) the campaign would silently never send.
  if (!isEmailProviderConfigured(provider)) {
    throw refusal('email_provider_required', { message: EMAIL_PROVIDER_REQUIRED });
  }
  const htmlBody = args.htmlBody?.trim();
  if (htmlBody) {
    assertHtmlBodySize(htmlBody);
    // Custom (WYSIWYG) email: a subject is required.
    const subject = args.subject?.trim();
    if (!subject) {
      throw refusal('email_subject_required', { message: 'L’objet de l’e-mail est requis.' });
    }
    return { subject, htmlBody };
  }
  // Brevo merges a template server-side, so templates are unavailable under SMTP.
  if (provider.kind === 'smtp') {
    throw refusal('brevo_template_unavailable', {
      message:
        'Les modèles Brevo ne sont pas disponibles en mode SMTP. Utilisez un e-mail personnalisé.',
    });
  }
  if (!follows(positiveIntSchema, args.brevoTemplateId)) {
    throw refusal('brevo_template_invalid', { message: 'ID de template Brevo invalide.' });
  }
  return { brevoTemplateId: args.brevoTemplateId };
}
