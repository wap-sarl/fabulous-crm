import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import {
  Button,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Card,
  FunnelBar,
  PageHeader,
  Spinner,
  StatCard,
  StatusBadge,
  TimeSeriesChart,
  toast,
} from '@crm/design-system';
import {
  AlertTriangle,
  BellOff,
  CalendarPlus,
  CheckCheck,
  CheckCircle2,
  Eye,
  FileCode2,
  MailOpen,
  MailX,
  MessageSquare,
  MousePointerClick,
  RotateCcw,
  Send,
  Timer,
  Users,
} from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { CampaignChannelBadge } from '../../features/campaigns/components/CampaignChannelBadge';
import { CampaignEventsTable } from '../../features/campaigns/components/CampaignEventsTable';
import { CampaignMessagePreview } from '../../features/campaigns/components/CampaignMessagePreview';
import { RecipientPreviewSheet } from '../../features/campaigns/components/RecipientPreviewSheet';
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  SEND_STATUS_LABEL,
  SEND_STATUS_TONE,
  formatSendError,
} from '../../lib/constants';

/** Build a recipient's display name from the merge values stored on the send. */
function sendLeadName(params: Record<string, string>): string {
  return `${params.firstName ?? ''} ${params.lastName ?? ''}`.trim();
}

const RETRY_ERRORS: Record<string, string> = {
  campaign_sending: 'Un envoi est déjà en cours. Réessayez une fois terminé.',
  send_pending: 'Cet envoi est déjà en file d’attente.',
  no_contact: "Ce destinataire n'a pas de coordonnée (e-mail/téléphone) pour l'envoi.",
  link_base_missing: 'Configuration manquante : impossible de générer les liens de suivi.',
  send_not_found: 'Envoi introuvable.',
  campaign_not_found: 'Campagne introuvable.',
};

/** Map a resend mutation error to a user-facing French message. */
function retryErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  const code = Object.keys(RETRY_ERRORS).find((k) => raw.includes(k));
  if (code) return RETRY_ERRORS[code];
  // The provider guards throw already-French, user-facing messages.
  if (raw.includes('fournisseur')) {
    return "Aucun fournisseur d'e-mail n'est configuré. Configurez-le dans Paramètres → E-mail.";
  }
  if (raw.includes('compte Brevo')) {
    return 'Les campagnes SMS nécessitent un compte Brevo configuré.';
  }
  return "L'action a échoué. Veuillez réessayer.";
}

const numberFormat = new Intl.NumberFormat('fr-FR');
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Bucket sentAt timestamps by hour (or by day when the span exceeds 48h). */
function buildSendSeries(sentAts: number[]): { label: string; value: number }[] {
  if (sentAts.length === 0) return [];
  const min = Math.min(...sentAts);
  const max = Math.max(...sentAts);
  const bucketSize = max - min > 2 * DAY ? DAY : HOUR;
  const labelFormat =
    bucketSize === DAY
      ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
      : new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const buckets = new Map<number, number>();
  for (const t of sentAts) {
    const bucket = Math.floor(t / bucketSize) * bucketSize;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucket, count]) => ({ label: labelFormat.format(bucket), value: count }));
}

export function CampaignDetailPage() {
  usePageTitle('Campagne');
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [selectedSendId, setSelectedSendId] = useState<Id<'campaignSends'> | null>(null);
  const [retrying, setRetrying] = useState(false);
  const data = useAuthQuery(
    api.features.crm.queries.getCampaign,
    campaignId ? { campaignId: campaignId as Id<'campaigns'> } : 'skip',
  );
  const retrySend = useAuthMutation(api.features.crm.mutations.retryCampaignSend);
  const resendAll = useAuthMutation(api.features.crm.mutations.resendAllCampaignSends);

  const sends = useMemo(() => data?.sends ?? [], [data]);
  const series = useMemo(
    () => buildSendSeries(sends.map((s) => s.sentAt).filter((t): t is number => !!t)),
    [sends],
  );
  const recipientBySendId = useMemo(
    () =>
      new Map(
        sends.map((s) => [
          s._id,
          { name: sendLeadName(s.params), contact: s.email ?? s.phone ?? '' },
        ]),
      ),
    [sends],
  );

  if (data === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (data === null) {
    return <p className="p-7 text-faint">Campagne introuvable.</p>;
  }

  const { campaign } = data;
  const isSms = campaign.channel === 'sms';
  // Resend can only run when the campaign is settled (not mid-drain).
  const canRetry = campaign.status !== 'sending';

  const handleRetrySend = async (sendId: Id<'campaignSends'>) => {
    setRetrying(true);
    try {
      await retrySend({ campaignId: campaign._id, sendId });
      toast.success('Renvoi relancé.');
    } catch (err) {
      toast.error(retryErrorMessage(err));
    } finally {
      setRetrying(false);
    }
  };

  const handleResendAll = async () => {
    if (
      !window.confirm(
        `Renvoyer la campagne à ses ${numberFormat.format(campaign.totalCount)} destinataire(s) ? ` +
          'Les personnes déjà livrées la recevront à nouveau.',
      )
    )
      return;
    setRetrying(true);
    try {
      const res = await resendAll({ campaignId: campaign._id });
      toast.success(`${res?.resent ?? 0} envoi(s) relancé(s).`);
    } catch (err) {
      toast.error(retryErrorMessage(err));
    } finally {
      setRetrying(false);
    }
  };
  // Email sent over SMTP has no provider tracking (opens/delivery/bounces); only
  // the self-hosted tracked-link clicks are recorded.
  const isSmtp = !isSms && campaign.emailProvider === 'smtp';

  const skippedStatus = isSms ? 'skipped_no_phone' : 'skipped_no_email';
  const skippedCount = sends.filter((s) => s.status === skippedStatus).length;
  const pendingCount = sends.filter((s) => s.status === 'pending').length;
  const openedCount = sends.filter((s) => s.openedAt !== undefined).length;
  const clickedCount = sends.filter((s) => s.clickedAt !== undefined).length;
  // SMS-only delivery lifecycle (from Brevo SMS webhook events).
  const deliveredCount = sends.filter((s) => s.deliveredAt !== undefined).length;
  const repliedCount = sends.filter((s) => s.repliedAt !== undefined).length;
  const unsubscribedCount = sends.filter((s) => s.unsubscribedAt !== undefined).length;
  const bouncedCount = sends.filter((s) => s.bouncedAt !== undefined).length;
  const pctOfSent = (n: number) => (campaign.sentCount > 0 ? (n / campaign.sentCount) * 100 : 0);
  const reachable = campaign.totalCount - skippedCount;
  const sendRate = campaign.totalCount > 0 ? (campaign.sentCount / campaign.totalCount) * 100 : 0;
  const failRate = campaign.totalCount > 0 ? (campaign.failedCount / campaign.totalCount) * 100 : 0;
  const pct = (n: number) => (campaign.totalCount > 0 ? (n / campaign.totalCount) * 100 : 0);

  return (
    <div className="flex flex-col">
      <PageHeader
        onBack={() => navigate('/campaigns')}
        title={campaign.name}
        titleExtra={
          <>
            <CampaignChannelBadge channel={campaign.channel} />
            <StatusBadge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>
              {CAMPAIGN_STATUS_LABEL[campaign.status]}
            </StatusBadge>
          </>
        }
        subtitle={`${numberFormat.format(campaign.totalCount)} destinataire(s) · créée le ${dateFormat.format(campaign._creationTime)}`}
        actions={
          canRetry ? (
            <Button variant="outline" onClick={handleResendAll} loading={retrying}>
              <RotateCcw className="size-4" />
              Tout renvoyer
            </Button>
          ) : undefined
        }
      />

      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-5 py-5 sm:px-7">
        {isSmtp && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
            Campagne envoyée en mode SMTP : le suivi des ouvertures, des remises et des rebonds
            n'est pas disponible. Seuls les clics sur les liens de suivi sont enregistrés.
          </p>
        )}
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

        {series.length > 0 && (
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-ink">Envois dans le temps</h2>
              <span className="inline-flex items-center gap-1.5 text-xs text-soft">
                <span className="size-2 rounded-full bg-chart-1" />
                Envois
              </span>
            </div>
            <TimeSeriesChart series={series} />
          </Card>
        )}

        <Card className="max-w-[560px] p-5">
          <h2 className="mb-4 text-[15px] font-bold text-ink">Entonnoir d'envoi</h2>
          <div className="flex flex-col gap-3.5">
            <FunnelBar
              label="Destinataires"
              count={campaign.totalCount}
              percent={100}
              color="#6A4BF0"
            />
            <FunnelBar
              label={isSms ? 'Avec téléphone' : 'Avec e-mail'}
              count={reachable}
              percent={pct(reachable)}
              color="#4B41E0"
            />
            <FunnelBar
              label="Envoyés"
              count={campaign.sentCount}
              percent={pct(campaign.sentCount)}
              color="#12A150"
            />
            {isSms && (
              <FunnelBar
                label="Délivrés"
                count={deliveredCount}
                percent={pct(deliveredCount)}
                color="#0C8A43"
              />
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-bold text-ink">Message envoyé</h2>
          <CampaignMessagePreview {...data.messagePreview} />
        </Card>

        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-bold text-ink">Événements</h2>
          <CampaignEventsTable
            campaignId={campaign._id}
            recipientBySendId={recipientBySendId}
            onSelectSend={setSelectedSendId}
          />
        </section>

        <div className="rounded-xl border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Destinataire</TableHead>
                <TableHead>{isSms ? 'Téléphone' : 'E-mail'}</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Envoyé le</TableHead>
                {!isSms && <TableHead>Ouvert</TableHead>}
                <TableHead>Cliqué</TableHead>
                <TableHead>Erreur</TableHead>
                <TableHead className="pr-4 text-right">Aperçu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sends.map((s) => {
                const name = sendLeadName(s.params);
                return (
                  <TableRow
                    key={s._id}
                    className="cursor-pointer"
                    onClick={() => setSelectedSendId(s._id)}
                  >
                    <TableCell className="pl-4 text-[13px] font-medium text-ink">
                      {name || '—'}
                    </TableCell>
                    <TableCell className="text-[13px] text-body">
                      {(isSms ? s.phone : s.email) ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={SEND_STATUS_TONE[s.status]}>
                        {SEND_STATUS_LABEL[s.status]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-[12.5px] text-soft">
                      {s.sentAt ? dateTimeFormat.format(s.sentAt) : '—'}
                    </TableCell>
                    {!isSms && (
                      <TableCell>
                        {s.openedAt ? (
                          <span title={dateTimeFormat.format(s.openedAt)}>
                            <StatusBadge tone="violet">Ouvert</StatusBadge>
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {s.clickedAt ? (
                        <span title={dateTimeFormat.format(s.clickedAt)}>
                          <StatusBadge tone="green">Cliqué</StatusBadge>
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-faint">
                      {s.error ? <span title={s.error}>{formatSendError(s.error)}</span> : ''}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <span className="inline-flex items-center justify-end gap-2">
                        {s.status !== 'pending' && canRetry && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleRetrySend(s._id);
                            }}
                            disabled={retrying}
                            title="Renvoyer l'envoi"
                            aria-label={`Renvoyer l'envoi à ${name || s.email || s.phone || 'ce destinataire'}`}
                            className="inline-flex cursor-pointer items-center justify-center text-soft transition-colors hover:text-primary disabled:cursor-default disabled:opacity-40"
                          >
                            <RotateCcw className="size-4" />
                          </button>
                        )}
                        <span className="inline-flex items-center justify-center text-soft transition-colors hover:text-primary">
                          <Eye className="size-4" />
                        </span>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <RecipientPreviewSheet sendId={selectedSendId} onClose={() => setSelectedSendId(null)} />
    </div>
  );
}
