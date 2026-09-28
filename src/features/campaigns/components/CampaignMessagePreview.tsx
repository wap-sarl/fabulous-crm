import { FileWarning, MessageSquare } from 'lucide-react';
import { cn } from '@crm/design-system';

/** An email carries `subject` and `html`, an SMS `sms`, a Brevo-template email only `templateId`: its HTML lives on Brevo, so it cannot be previewed. */
export interface MessagePreviewData {
  channel: 'email' | 'sms';
  subject?: string | null;
  html?: string | null;
  sms?: string | null;
  templateId?: number | null;
}

/** Email HTML renders in a sandboxed iframe without scripts, so authored markup cannot touch the app. */
export function CampaignMessagePreview({
  channel,
  subject,
  html,
  sms,
  templateId,
  className,
}: MessagePreviewData & { className?: string }) {
  if (templateId != null) {
    return (
      <div
        className={cn(
          'flex items-start gap-3 rounded-xl border border-dashed bg-muted/40 p-4',
          className,
        )}
      >
        <FileWarning className="mt-0.5 size-4 shrink-0 text-soft" />
        <div className="text-[13px] text-soft">
          <p className="font-medium text-body">Aperçu indisponible</p>
          <p>
            Cette campagne utilise le template Brevo{' '}
            <span className="font-mono text-body">#{templateId}</span>. Son contenu HTML est géré
            par Brevo et n'est pas stocké dans le CRM.
          </p>
        </div>
      </div>
    );
  }

  if (channel === 'sms') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        {sms ? (
          <div className="flex items-end gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#EFEBFE] text-[#6A4BF0]">
              <MessageSquare className="size-3.5" />
            </span>
            <div className="max-w-[420px] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-[#EFEBFE] px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
              {sms}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-faint">Aucun contenu SMS.</p>
        )}
      </div>
    );
  }

  // Email with custom HTML body.
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {subject != null && subject !== '' && (
        <div className="text-[13px]">
          <span className="text-soft">Objet : </span>
          <span className="font-medium text-ink">{subject}</span>
        </div>
      )}
      {html ? (
        <div className="overflow-hidden rounded-xl border bg-white">
          <iframe
            title="Aperçu de l'e-mail"
            srcDoc={html}
            sandbox=""
            className="h-[460px] w-full border-0"
          />
        </div>
      ) : (
        <p className="text-[13px] text-faint">Aucun contenu e-mail.</p>
      )}
    </div>
  );
}
