import { useCallback, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { Card, Spinner, toast } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { CampaignDetailHeader } from '../../features/campaigns/components/CampaignDetailHeader';
import { CampaignEventsTable } from '../../features/campaigns/components/CampaignEventsTable';
import { CampaignMessagePreview } from '../../features/campaigns/components/CampaignMessagePreview';
import { CampaignSendFunnel } from '../../features/campaigns/components/CampaignSendFunnel';
import { CampaignSendsChart } from '../../features/campaigns/components/CampaignSendsChart';
import { CampaignSendsTable } from '../../features/campaigns/components/CampaignSendsTable';
import { CampaignStatCards } from '../../features/campaigns/components/CampaignStatCards';
import { RecipientPreviewSheet } from '../../features/campaigns/components/RecipientPreviewSheet';
import { retryErrorMessage } from '../../features/campaigns/lib/retryErrors';
import { buildSendSeries } from '../../features/campaigns/lib/sends';
import { numberFormat } from '@crm/lib/format';

export function CampaignDetailPage() {
  usePageTitle('Campagne');
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [selectedSendId, setSelectedSendId] = useState<Id<'campaignSends'> | null>(null);
  const [retrying, setRetrying] = useState(false);
  const data = useAuthQuery(
    api.features.campaigns.queries.getCampaign,
    campaignId ? { campaignId: campaignId as Id<'campaigns'> } : 'skip',
  );
  // Apart from the campaign: a provider event changes the counters only.
  const stats = useAuthQuery(
    api.features.campaigns.queries.getCampaignStats,
    campaignId ? { campaignId: campaignId as Id<'campaigns'> } : 'skip',
  );
  const retrySend = useAuthMutation(api.features.campaigns.mutations.retryCampaignSend);
  const resendAll = useAuthMutation(api.features.campaigns.mutations.resendAllCampaignSends);
  // Stable for the memoised recipients table.
  const handleRetrySend = useCallback(
    async (sendId: Id<'campaignSends'>) => {
      setRetrying(true);
      try {
        await retrySend({ campaignId: campaignId as Id<'campaigns'>, sendId });
        toast.success('Renvoi relancé.');
      } catch (err) {
        toast.error(retryErrorMessage(err));
      } finally {
        setRetrying(false);
      }
    },
    [retrySend, campaignId],
  );
  const sentByHour = stats?.sentByHour;
  const series = useMemo(() => buildSendSeries(sentByHour ?? {}), [sentByHour]);

  if (data === undefined || stats === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (data === null || stats === null) {
    return <p className="p-7 text-faint">Campagne introuvable.</p>;
  }

  const { campaign } = data;
  const isSms = campaign.channel === 'sms';
  // Resend can only run when the campaign is settled (not mid-preparation/drain).
  const canRetry = campaign.status !== 'sending' && campaign.status !== 'preparing';

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
      await resendAll({ campaignId: campaign._id });
      toast.success('Renvoi lancé : les destinataires sont remis en file.');
    } catch (err) {
      toast.error(retryErrorMessage(err));
    } finally {
      setRetrying(false);
    }
  };
  // Over SMTP there is no provider tracking: only the self-hosted tracked-link clicks are recorded.
  const isSmtp = !isSms && campaign.emailProvider === 'smtp';

  return (
    <div className="flex flex-col">
      <CampaignDetailHeader
        campaign={campaign}
        canRetry={canRetry}
        retrying={retrying}
        handleResendAll={handleResendAll}
        navigate={navigate}
      />

      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-5 py-5 sm:px-7">
        {campaign.status === 'preparing' && (
          <p className="rounded-lg border border-info/40 bg-info/10 px-4 py-2 text-xs text-info">
            Préparation des destinataires en cours — {numberFormat.format(campaign.totalCount)}{' '}
            destinataire(s). L'envoi démarrera automatiquement à la fin de la préparation.
          </p>
        )}
        {isSmtp && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
            Campagne envoyée en mode SMTP : le suivi des ouvertures, des remises et des rebonds
            n'est pas disponible. Seuls les clics sur les liens de suivi sont enregistrés.
          </p>
        )}
        <CampaignStatCards campaign={campaign} stats={stats} isSms={isSms} isSmtp={isSmtp} />

        {series.length > 0 && <CampaignSendsChart series={series} />}

        <CampaignSendFunnel
          campaign={campaign}
          isSms={isSms}
          skippedCount={stats.skipped}
          deliveredCount={stats.delivered}
        />

        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-bold text-ink">Message envoyé</h2>
          <CampaignMessagePreview {...data.messagePreview} />
        </Card>

        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-bold text-ink">Événements</h2>
          <CampaignEventsTable campaignId={campaign._id} onSelectSend={setSelectedSendId} />
        </section>

        <CampaignSendsTable
          campaignId={campaign._id}
          isSms={isSms}
          canRetry={canRetry}
          retrying={retrying}
          handleRetrySend={handleRetrySend}
          setSelectedSendId={setSelectedSendId}
        />
      </div>

      <RecipientPreviewSheet sendId={selectedSendId} onClose={() => setSelectedSendId(null)} />
    </div>
  );
}
