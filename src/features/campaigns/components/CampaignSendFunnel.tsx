import type { Doc } from '@crm/lib/backend';
import { Card, FunnelBar } from '@crm/design-system';

/** The funnel of a campaign: recipients, those reachable on its channel, sent, and delivered for an SMS. */
export function CampaignSendFunnel({
  campaign,
  isSms,
  skippedCount,
  deliveredCount,
}: {
  campaign: Doc<'campaigns'>;
  isSms: boolean;
  skippedCount: number;
  deliveredCount: number;
}) {
  const reachable = campaign.totalCount - skippedCount;
  const pct = (n: number) => (campaign.totalCount > 0 ? (n / campaign.totalCount) * 100 : 0);

  return (
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
  );
}
