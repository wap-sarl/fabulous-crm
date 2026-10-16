import type { NavigateFunction } from 'react-router-dom';
import type { Doc } from '@crm/lib/backend';
import { Button, PageHeader, StatusBadge } from '@crm/design-system';
import { OctagonX, Play, RotateCcw, Trash2 } from 'lucide-react';
import { CampaignChannelBadge } from './CampaignChannelBadge';
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE } from '../../../lib/constants';
import { describeError } from '@crm/lib/errors';
import { dateFormat, numberFormat } from '@crm/lib/format';

/** The header of a campaign's page: its name, channel, status, the stop while it sends, and once it is settled the resends and the deletion. */
export function CampaignDetailHeader({
  campaign,
  failedSends,
  canRetry,
  canStop,
  retrying,
  handleResendAll,
  handleRetryFailed,
  handleResume,
  handleStop,
  handleDelete,
  navigate,
}: {
  campaign: Doc<'campaigns'>;
  /** The sends that failed, the skipped ones left out: what « Relancer les échecs » sends again. */
  failedSends: number;
  canRetry: boolean;
  canStop: boolean;
  retrying: boolean;
  handleResendAll: () => Promise<void>;
  handleRetryFailed: () => Promise<void>;
  handleResume: () => Promise<void>;
  handleStop: () => void;
  handleDelete: () => void;
  navigate: NavigateFunction;
}) {
  return (
    <PageHeader
      onBack={() => navigate('/campaigns')}
      title={campaign.name}
      titleExtra={
        <>
          <CampaignChannelBadge channel={campaign.channel} />
          <StatusBadge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>
            {CAMPAIGN_STATUS_LABEL[campaign.status]}
          </StatusBadge>
          {campaign.status === 'failed' && campaign.failureReason ? (
            <span className="text-sm text-soft" data-testid="campaign-failure-reason">
              {describeError(campaign.failureReason, campaign.failureReason)}
            </span>
          ) : null}
        </>
      }
      subtitle={`${numberFormat.format(campaign.totalCount)} destinataire(s) · créée le ${dateFormat.format(campaign._creationTime)}`}
      actions={
        canStop ? (
          <Button variant="outline" onClick={handleStop} loading={retrying}>
            <OctagonX className="size-4" />
            Arrêter l’envoi
          </Button>
        ) : canRetry ? (
          <>
            {campaign.status === 'stopped' && (
              <Button onClick={handleResume} loading={retrying}>
                <Play className="size-4" />
                Reprendre l’envoi
              </Button>
            )}
            {failedSends > 0 && (
              <Button onClick={handleRetryFailed} loading={retrying} data-testid="retry-failed">
                <RotateCcw className="size-4" />
                Relancer les échecs ({numberFormat.format(failedSends)})
              </Button>
            )}
            <Button variant="outline" onClick={handleResendAll} loading={retrying}>
              <RotateCcw className="size-4" />
              Tout renvoyer
            </Button>
            <Button
              variant="outline"
              color="destructive"
              onClick={handleDelete}
              data-testid="delete-campaign"
            >
              <Trash2 className="size-4" />
              Supprimer
            </Button>
          </>
        ) : campaign.status === 'scheduled' || campaign.status === 'draft' ? (
          <Button variant="outline" color="destructive" onClick={handleDelete}>
            <Trash2 className="size-4" />
            Supprimer
          </Button>
        ) : undefined
      }
    />
  );
}
