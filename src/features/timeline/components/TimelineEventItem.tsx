import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { TimelineEvent } from '@crm/lib/backend';
import { StatusBadge, cn } from '@crm/design-system';
import type { StatusTone } from '@crm/design-system';
import type { LucideIcon } from 'lucide-react';
import {
  Ban,
  Eye,
  Handshake,
  Mail,
  MessageSquare,
  Milestone,
  MousePointerClick,
  Pencil,
  Send,
  StickyNote,
  UserPlus,
  Workflow,
} from 'lucide-react';
import {
  ACTIVITY_STATUS_LABEL,
  ACTIVITY_STATUS_TONE,
  ACTIVITY_TYPE_LABEL,
  DEAL_STATUS_LABEL,
  DEAL_STATUS_TONE,
  EVENT_TYPE_LABEL,
  EVENT_TYPE_TONE,
  SEND_STATUS_LABEL,
  SEND_STATUS_TONE,
  formatMoney,
} from '../../../lib/constants';
import { ACTIVITY_ICON } from '../../activities/lib/constants';
import { LIFECYCLE_SOURCE_LABEL } from '../../leads/lib/lifecycle';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from '../../workflows/lib/constants';
import { LEAD_FIELD_LABEL } from '../lib/constants';

const timeFormat = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' });
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const TONE_ICON_STYLE: Record<StatusTone, string> = {
  blue: 'bg-[#E8F0FE] text-[#1A56DB]',
  amber: 'bg-[#FEF3E2] text-[#B45309]',
  violet: 'bg-[#EFEBFE] text-[#6A4BF0]',
  green: 'bg-[#E6F6EC] text-[#1B7F3B]',
  red: 'bg-[#FDE8E8] text-[#B42318]',
  gray: 'bg-[#F2F3F5] text-[#5C6370]',
};

interface Presentation {
  Icon: LucideIcon;
  tone: StatusTone;
  title: ReactNode;
  badge?: { label: string; tone: StatusTone };
  detail?: ReactNode;
}

const joinDetails = (parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(' · ');

/**
 * How each event kind renders. Adding a source = one case here (plus its
 * reader in `convex/features/timeline/queries.ts`).
 */
function present(event: TimelineEvent, lifecycleLabel: (key: string) => string): Presentation {
  switch (event.kind) {
    case 'note':
      return {
        Icon: StickyNote,
        tone: 'amber',
        title: event.authorName ? `Note de ${event.authorName}` : 'Note',
        badge: event.isPinned ? { label: 'Épinglée', tone: 'amber' } : undefined,
        detail: <span className="line-clamp-3 whitespace-pre-wrap">{event.content}</span>,
      };
    case 'activity':
      return {
        Icon: ACTIVITY_ICON[event.type],
        tone: 'blue',
        title: `${ACTIVITY_TYPE_LABEL[event.type]} · ${event.title}`,
        badge: {
          label: ACTIVITY_STATUS_LABEL[event.status],
          tone: ACTIVITY_STATUS_TONE[event.status],
        },
        detail: joinDetails([
          event.completedAt
            ? `Terminée le ${dateTimeFormat.format(event.completedAt)}`
            : event.dueAt
              ? `Échéance le ${dateTimeFormat.format(event.dueAt)}`
              : null,
          event.ownerName,
          event.outcome && `↳ ${event.outcome}`,
        ]),
      };
    case 'campaign_send':
      return {
        Icon: event.channel === 'sms' ? MessageSquare : Send,
        tone: 'violet',
        title: (
          <>
            {event.channel === 'sms' ? 'SMS' : 'E-mail'} ·{' '}
            <Link to={`/campaigns/${event.campaignId}`} className="hover:underline">
              {event.campaignName}
            </Link>
          </>
        ),
        badge: { label: SEND_STATUS_LABEL[event.status], tone: SEND_STATUS_TONE[event.status] },
        detail: joinDetails([
          event.sentAt ? `Envoyé le ${dateTimeFormat.format(event.sentAt)}` : null,
          event.error,
        ]),
      };
    case 'campaign_event': {
      const Icon =
        event.type === 'opened'
          ? Eye
          : event.type === 'clicked' || event.type === 'link_click'
            ? MousePointerClick
            : event.type === 'sms_reply'
              ? MessageSquare
              : event.type === 'delivered'
                ? Mail
                : Ban;
      return {
        Icon,
        tone: EVENT_TYPE_TONE[event.type],
        title: (
          <>
            {EVENT_TYPE_LABEL[event.type]} ·{' '}
            <Link to={`/campaigns/${event.campaignId}`} className="hover:underline">
              {event.campaignName}
            </Link>
          </>
        ),
        detail: joinDetails([event.linkLabel, event.url, event.reason]),
      };
    }
    case 'workflow_run':
      return {
        Icon: Workflow,
        tone: 'blue',
        title: (
          <>
            Workflow ·{' '}
            {event.workflowName ? (
              <Link to={`/workflows/${event.workflowId}`} className="hover:underline">
                {event.workflowName}
              </Link>
            ) : (
              'supprimé'
            )}
          </>
        ),
        badge: { label: RUN_STATUS_LABEL[event.status], tone: RUN_STATUS_TONE[event.status] },
        detail: joinDetails([
          event.manual ? 'Inscription manuelle' : 'Inscription automatique',
          event.finishedAt ? `Terminé le ${dateTimeFormat.format(event.finishedAt)}` : null,
          event.error,
        ]),
      };
    case 'lifecycle': {
      const actor =
        event.source === 'workflow'
          ? (event.workflowName ?? 'Workflow')
          : (event.changedByName ?? LIFECYCLE_SOURCE_LABEL[event.source]);
      return {
        Icon: Milestone,
        tone: 'violet',
        title: event.from
          ? `Statut : ${lifecycleLabel(event.from)} → ${lifecycleLabel(event.to)}`
          : `Statut initial : ${lifecycleLabel(event.to)}`,
        detail: joinDetails([
          actor,
          event.source !== 'workflow' &&
            !!event.changedByName &&
            LIFECYCLE_SOURCE_LABEL[event.source].toLowerCase(),
        ]),
      };
    }
    case 'deal':
      return {
        Icon: Handshake,
        tone: 'green',
        title: (
          <>
            Transaction ·{' '}
            <Link to={`/deals/${event.dealId}`} className="hover:underline">
              {event.title}
            </Link>
          </>
        ),
        badge: { label: DEAL_STATUS_LABEL[event.status], tone: DEAL_STATUS_TONE[event.status] },
        detail: joinDetails([
          event.pipelineName,
          event.stageLabel,
          event.amount !== null && formatMoney(event.amount, event.currency),
        ]),
      };
    case 'audit':
      return event.action === 'create'
        ? {
            Icon: UserPlus,
            tone: 'gray',
            title: 'Lead créé',
            detail: event.userName,
          }
        : {
            Icon: Pencil,
            tone: 'gray',
            title: 'Fiche modifiée',
            detail: joinDetails([
              event.fields.map((f) => LEAD_FIELD_LABEL[f] ?? f).join(', '),
              event.userName,
            ]),
          };
  }
}

export function TimelineEventItem({
  event,
  lifecycleLabel,
}: {
  event: TimelineEvent;
  lifecycleLabel: (key: string) => string;
}) {
  const { Icon, tone, title, badge, detail } = present(event, lifecycleLabel);
  return (
    <li className="flex items-start gap-3 py-2.5" data-testid={`timeline-${event.kind}`}>
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
          TONE_ICON_STYLE[tone],
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{title}</span>
          {badge ? (
            <StatusBadge tone={badge.tone} withDot={false}>
              {badge.label}
            </StatusBadge>
          ) : null}
          <time
            className="ml-auto shrink-0 text-xs text-faint"
            dateTime={new Date(event.at).toISOString()}
          >
            {timeFormat.format(event.at)}
          </time>
        </span>
        {detail ? <span className="block break-words text-xs text-faint">{detail}</span> : null}
      </span>
    </li>
  );
}
