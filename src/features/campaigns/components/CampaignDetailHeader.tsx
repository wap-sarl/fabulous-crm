import type { NavigateFunction } from 'react-router-dom';
import type { Doc } from '@crm/lib/backend';
import { Button, PageHeader, StatusBadge } from '@crm/design-system';
import { OctagonX, RotateCcw } from 'lucide-react';
import { CampaignChannelBadge } from './CampaignChannelBadge';
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE } from '../../../lib/constants';
import { describeError } from '@crm/lib/errors';
import { dateFormat, numberFormat } from '@crm/lib/format';

/** The header of a campaign's page: its name, channel, status, the stop while it sends, and the resend-all action once it is settled. */
export function CampaignDetailHeader({
  campaign,
  canRetry,
  canStop,
  retrying,
  handleResendAll,
  handleStop,
  navigate,
}: {
  campaign: Doc<'campaigns'>;
  canRetry: boolean;
  canStop: boolean;
  retrying: boolean;
  handleResendAll: () => Promise<void>;
  handleStop: () => void;
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
          <Button variant="outline" onClick={handleResendAll} loading={retrying}>
            <RotateCcw className="size-4" />
            Tout renvoyer
          </Button>
        ) : undefined
      }
    />
  );
}
