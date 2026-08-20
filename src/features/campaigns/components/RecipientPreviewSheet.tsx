import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Spinner,
  StatusBadge,
} from '@crm/design-system';
import {
  EVENT_TYPE_LABEL,
  EVENT_TYPE_TONE,
  SEND_STATUS_LABEL,
  SEND_STATUS_TONE,
  formatSendError,
} from '../../../lib/constants';
import { CampaignMessagePreview } from './CampaignMessagePreview';

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Right-side drawer showing exactly what one recipient received: the campaign
 * template re-rendered with that send's stored merge values. Opened from a
 * recipient row on the campaign detail page. The send is fetched lazily (only
 * while the drawer is open) so we never render a preview for every recipient.
 */
export function RecipientPreviewSheet({
  sendId,
  onClose,
}: {
  sendId: Id<'campaignSends'> | null;
  onClose: () => void;
}) {
  const preview = useAuthQuery(
    api.features.crm.queries.getCampaignSendPreview,
    sendId ? { sendId } : 'skip'
  );

  return (
    <Sheet open={sendId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        {sendId === null ? null : preview === undefined ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : preview === null ? (
          <div className="p-6">
            <p className="text-[13px] text-faint">Envoi introuvable.</p>
          </div>
        ) : (
          <>
            <SheetHeader className="border-b p-6 text-left">
              <SheetTitle>{preview.leadName ?? preview.contact ?? 'Destinataire'}</SheetTitle>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-soft">
                {preview.contact && <span className="font-mono">{preview.contact}</span>}
                <StatusBadge tone={SEND_STATUS_TONE[preview.status]}>
                  {SEND_STATUS_LABEL[preview.status]}
                </StatusBadge>
                {preview.sentAt && (
                  <span>Envoyé le {dateTimeFormat.format(preview.sentAt)}</span>
                )}
                {preview.openedAt && (
                  <span>Ouvert le {dateTimeFormat.format(preview.openedAt)}</span>
                )}
                {preview.clickedAt && (
                  <span>Cliqué le {dateTimeFormat.format(preview.clickedAt)}</span>
                )}
              </div>
              {preview.error && (
                <p className="text-xs text-[#D23B3F]" title={preview.error}>
                  {formatSendError(preview.error)}
                </p>
              )}
            </SheetHeader>
            {(preview.events.length > 0 || preview.sentAt) && (
              <div className="border-b p-6">
                <h3 className="mb-3 text-[13px] font-bold text-ink">Chronologie</h3>
                <ul className="flex flex-col gap-2.5">
                  {preview.events.map((event) => (
                    <li key={event._id} className="flex items-center gap-2.5 text-[13px]">
                      <span className="size-1.5 shrink-0 rounded-full bg-border" />
                      <StatusBadge tone={EVENT_TYPE_TONE[event.type]}>
                        {EVENT_TYPE_LABEL[event.type]}
                      </StatusBadge>
                      <span className="whitespace-nowrap font-mono text-[12.5px] text-soft">
                        {dateTimeFormat.format(event.eventAt)}
                      </span>
                      <span className="truncate text-xs text-faint">
                        {event.linkLabel ?? event.url ?? event.reason ?? ''}
                      </span>
                    </li>
                  ))}
                  {preview.sentAt && (
                    <li className="flex items-center gap-2.5 text-[13px]">
                      <span className="size-1.5 shrink-0 rounded-full bg-border" />
                      <StatusBadge tone="gray">Envoyé</StatusBadge>
                      <span className="whitespace-nowrap font-mono text-[12.5px] text-soft">
                        {dateTimeFormat.format(preview.sentAt)}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            )}
            <div className="p-6">
              <CampaignMessagePreview
                channel={preview.channel}
                subject={preview.subject}
                html={preview.html}
                sms={preview.sms}
                templateId={preview.templateId}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
