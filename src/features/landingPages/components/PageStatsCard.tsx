import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { Card, Spinner, StatCard, TimeSeriesChart } from '@crm/design-system';
import { Eye, Percent, Send } from 'lucide-react';
import { numberFormat, shortDateFormat } from '@crm/lib/format';

/** The last thirty days of a page: views, submissions, their ratio, and the views by day. */
export function PageStatsCard({ pageId }: { pageId: Id<'landingPages'> }) {
  const stats = useAuthQuery(api.features.landingPages.queries.getLandingPageStats, { pageId });
  if (stats === undefined) return <Spinner size="sm" />;
  if (stats === null) return null;
  const rate = stats.views > 0 ? (stats.submissions / stats.views) * 100 : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Vues"
          value={numberFormat.format(stats.views)}
          sub="30 derniers jours"
          icon={<Eye />}
        />
        <StatCard
          label="Envois du formulaire"
          value={numberFormat.format(stats.submissions)}
          sub="30 derniers jours"
          icon={<Send />}
          iconBg="var(--success-soft)"
          iconColor="var(--success)"
        />
        <StatCard
          label="Conversion"
          value={`${rate.toFixed(1)}%`}
          sub="envois / vues"
          icon={<Percent />}
          iconBg="var(--violet-soft)"
          iconColor="var(--violet)"
        />
      </div>
      <Card className="p-5">
        <h2 className="mb-4 text-[15px] font-bold text-ink">Vues par jour</h2>
        <TimeSeriesChart
          label="Vues par jour"
          series={stats.days.map((d) => ({
            label: shortDateFormat.format(new Date(`${d.day}T00:00:00Z`)),
            value: d.views,
          }))}
        />
      </Card>
    </div>
  );
}
