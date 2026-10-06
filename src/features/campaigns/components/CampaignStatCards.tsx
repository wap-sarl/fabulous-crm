import type { CampaignStats, Doc } from '@crm/lib/backend';
import { StatCard } from '@crm/design-system';
import {
  AlertTriangle,
  BellOff,
  CalendarPlus,
  CheckCheck,
  CheckCircle2,
  FileCode2,
  MailOpen,
  MailX,
  MessageSquare,
  MousePointerClick,
  Send,
  Timer,
  Users,
} from 'lucide-react';
import { dateFormat, numberFormat } from '@crm/lib/format';

/** The counters of a campaign: recipients, sends, failures, and the engagement its channel can track, as the campaign keeps them. */
export function CampaignStatCards({
  campaign,
  stats,
  isSms,
  isSmtp,
}: {
  campaign: Doc<'campaigns'>;
  stats: CampaignStats;
  isSms: boolean;
  isSmtp: boolean;
}) {
  const {
    pending: pendingCount,
    skipped: skippedCount,
    delivered: deliveredCount,
    opened: openedCount,
    clicked: clickedCount,
    replied: repliedCount,
    unsubscribed: unsubscribedCount,
    bounced: bouncedCount,
  } = stats;
  const pctOfSent = (n: number) => (campaign.sentCount > 0 ? (n / campaign.sentCount) * 100 : 0);
  const sendRate = campaign.totalCount > 0 ? (campaign.sentCount / campaign.totalCount) * 100 : 0;
  const failRate = campaign.totalCount > 0 ? (campaign.failedCount / campaign.totalCount) * 100 : 0;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="Destinataires"
        value={numberFormat.format(campaign.totalCount)}
        icon={<Users />}
        iconBg="var(--primary-soft)"
        iconColor="var(--primary-strong)"
      />
      <StatCard
        label="Envoyés"
        value={numberFormat.format(campaign.sentCount)}
        sub={`${sendRate.toFixed(1)}% du total`}
        icon={<Send />}
        iconBg="var(--success-soft)"
        iconColor="var(--success)"
      />
      <StatCard
        label="Échecs"
        value={numberFormat.format(campaign.failedCount)}
        sub={`${failRate.toFixed(1)}% du total`}
        icon={<AlertTriangle />}
        iconBg="var(--destructive-soft)"
        iconColor="var(--destructive)"
      />
      <StatCard
        label={isSms ? 'Ignorés — sans téléphone' : 'Ignorés — sans e-mail'}
        value={numberFormat.format(skippedCount)}
        icon={<MailX />}
        iconBg="var(--muted)"
        iconColor="var(--soft)"
      />
      <StatCard
        label="En attente"
        value={numberFormat.format(pendingCount)}
        icon={<Timer />}
        iconBg="var(--warning-soft)"
        iconColor="var(--warning)"
      />
      <StatCard
        label="Taux d'envoi"
        value={`${sendRate.toFixed(1)}%`}
        icon={<CheckCircle2 />}
        iconBg="var(--info-soft)"
        iconColor="var(--info)"
      />
      {isSms && (
        <>
          <StatCard
            label="Délivrés"
            value={numberFormat.format(deliveredCount)}
            sub={`${pctOfSent(deliveredCount).toFixed(1)}% des envoyés`}
            icon={<CheckCheck />}
            iconBg="var(--success-soft)"
            iconColor="var(--success)"
          />
          <StatCard
            label="Réponses"
            value={numberFormat.format(repliedCount)}
            icon={<MessageSquare />}
            iconBg="var(--info-soft)"
            iconColor="var(--info)"
          />
          <StatCard
            label="Désinscriptions"
            value={numberFormat.format(unsubscribedCount)}
            sub="STOP"
            icon={<BellOff />}
            iconBg="var(--destructive-soft)"
            iconColor="var(--destructive)"
          />
          <StatCard
            label="Rebonds"
            value={numberFormat.format(bouncedCount)}
            sub={`${pctOfSent(bouncedCount).toFixed(1)}% des envoyés`}
            icon={<AlertTriangle />}
            iconBg="var(--destructive-soft)"
            iconColor="var(--destructive)"
          />
        </>
      )}
      {!isSms && (
        <StatCard
          label="Ouvertures"
          value={isSmtp ? '—' : numberFormat.format(openedCount)}
          sub={
            isSmtp
              ? 'Suivi indisponible (SMTP)'
              : `${pctOfSent(openedCount).toFixed(1)}% des envoyés`
          }
          icon={<MailOpen />}
          iconBg="var(--violet-soft)"
          iconColor="var(--violet)"
        />
      )}
      <StatCard
        label="Clics"
        value={numberFormat.format(clickedCount)}
        sub={`${pctOfSent(clickedCount).toFixed(1)}% des envoyés`}
        icon={<MousePointerClick />}
        iconBg="var(--success-soft)"
        iconColor="var(--success)"
      />
      <StatCard
        label={
          campaign.brevoTemplateId !== undefined
            ? 'Template Brevo'
            : campaign.channel === 'sms'
              ? 'Canal'
              : 'Contenu'
        }
        value={
          campaign.brevoTemplateId !== undefined
            ? `#${campaign.brevoTemplateId}`
            : campaign.channel === 'sms'
              ? campaign.messageType === 'transactional'
                ? 'SMS · Transactionnel'
                : 'SMS · Marketing'
              : 'Éditeur HTML'
        }
        icon={<FileCode2 />}
        iconBg="color-mix(in srgb, var(--chart-4) 10%, white)"
        iconColor="var(--chart-4)"
      />
      <StatCard
        label="Créée le"
        value={dateFormat.format(campaign._creationTime)}
        icon={<CalendarPlus />}
        iconBg="var(--muted)"
        iconColor="var(--soft)"
      />
    </div>
  );
}
