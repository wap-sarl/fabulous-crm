import type { Doc } from '@crm/lib/backend';
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

/** The counters of a campaign: recipients, sends, failures, and the engagement its channel can track. */
export function CampaignStatCards({
  campaign,
  sends,
  isSms,
  isSmtp,
  skippedCount,
  deliveredCount,
}: {
  campaign: Doc<'campaigns'>;
  sends: Doc<'campaignSends'>[];
  isSms: boolean;
  isSmtp: boolean;
  skippedCount: number;
  deliveredCount: number;
}) {
  const pendingCount = sends.filter((s) => s.status === 'pending').length;
  const openedCount = sends.filter((s) => s.openedAt !== undefined).length;
  const clickedCount = sends.filter((s) => s.clickedAt !== undefined).length;
  const repliedCount = sends.filter((s) => s.repliedAt !== undefined).length;
  const unsubscribedCount = sends.filter((s) => s.unsubscribedAt !== undefined).length;
  const bouncedCount = sends.filter((s) => s.bouncedAt !== undefined).length;
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
        iconBg="#E3F6EC"
        iconColor="#0C8A43"
      />
      <StatCard
        label="Échecs"
        value={numberFormat.format(campaign.failedCount)}
        sub={`${failRate.toFixed(1)}% du total`}
        icon={<AlertTriangle />}
        iconBg="#FBE9E9"
        iconColor="#D23B3F"
      />
      <StatCard
        label={isSms ? 'Ignorés — sans téléphone' : 'Ignorés — sans e-mail'}
        value={numberFormat.format(skippedCount)}
        icon={<MailX />}
        iconBg="#F3F4F6"
        iconColor="#6B7280"
      />
      <StatCard
        label="En attente"
        value={numberFormat.format(pendingCount)}
        icon={<Timer />}
        iconBg="#FCF1DD"
        iconColor="#B4740A"
      />
      <StatCard
        label="Taux d'envoi"
        value={`${sendRate.toFixed(1)}%`}
        icon={<CheckCircle2 />}
        iconBg="#E7F0FF"
        iconColor="#1D6BE0"
      />
      {isSms && (
        <>
          <StatCard
            label="Délivrés"
            value={numberFormat.format(deliveredCount)}
            sub={`${pctOfSent(deliveredCount).toFixed(1)}% des envoyés`}
            icon={<CheckCheck />}
            iconBg="#E3F6EC"
            iconColor="#0C8A43"
          />
          <StatCard
            label="Réponses"
            value={numberFormat.format(repliedCount)}
            icon={<MessageSquare />}
            iconBg="#E7F0FF"
            iconColor="#1D6BE0"
          />
          <StatCard
            label="Désinscriptions"
            value={numberFormat.format(unsubscribedCount)}
            sub="STOP"
            icon={<BellOff />}
            iconBg="#FBE9E9"
            iconColor="#D23B3F"
          />
          <StatCard
            label="Rebonds"
            value={numberFormat.format(bouncedCount)}
            sub={`${pctOfSent(bouncedCount).toFixed(1)}% des envoyés`}
            icon={<AlertTriangle />}
            iconBg="#FBE9E9"
            iconColor="#D23B3F"
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
          iconBg="#EFEAFE"
          iconColor="#6A4BF0"
        />
      )}
      <StatCard
        label="Clics"
        value={numberFormat.format(clickedCount)}
        sub={`${pctOfSent(clickedCount).toFixed(1)}% des envoyés`}
        icon={<MousePointerClick />}
        iconBg="#E3F6EC"
        iconColor="#0C8A43"
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
        iconBg="#E6F6F6"
        iconColor="#0E8A8A"
      />
      <StatCard
        label="Créée le"
        value={dateFormat.format(campaign._creationTime)}
        icon={<CalendarPlus />}
        iconBg="#F3F4F6"
        iconColor="#6B7280"
      />
    </div>
  );
}
