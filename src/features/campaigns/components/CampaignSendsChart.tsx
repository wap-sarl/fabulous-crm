import { Card, TimeSeriesChart } from '@crm/design-system';

/** The sends of a campaign over time. */
export function CampaignSendsChart({ series }: { series: { label: string; value: number }[] }) {
  return (
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
  );
}
