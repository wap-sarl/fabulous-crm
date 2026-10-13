import type { CampaignStats, Doc } from '@crm/lib/backend';
import { Card, StatusBadge } from '@crm/design-system';
import { dateTimeFormat, numberFormat } from '@crm/lib/format';

const pct = (n: number, of: number) => (of > 0 ? `${((n / of) * 100).toFixed(1)} %` : '—');

/** The two variants side by side, with what each earned, and the decision: pending until the window closes, then the winner the rest received. */
export function CampaignVariantResults({
  campaign,
  stats,
}: {
  campaign: Doc<'campaigns'>;
  stats: CampaignStats;
}) {
  const test = campaign.abTest;
  if (!test) return null;
  const figures = (variant: 'A' | 'B') =>
    stats.variants?.[variant] ?? { sent: 0, opened: 0, clicked: 0 };
  const label = (variant: 'A' | 'B') =>
    test.kind === 'subject'
      ? (variant === 'A' ? campaign.subject : test.subjectB) || '—'
      : variant === 'A'
        ? 'Contenu A'
        : 'Contenu B';
  const metric = test.metric === 'opens' ? 'les ouvertures' : 'les clics';
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-ink">
          Test A/B sur {test.kind === 'subject' ? 'l’objet' : 'le contenu'}
        </h2>
        <span className="text-xs text-soft">
          {test.winner && test.decidedAt !== undefined
            ? test.decidedBy === 'fallback'
              ? `Données insuffisantes le ${dateTimeFormat.format(test.decidedAt)} : aucune variante n’avait de résultat sur ${metric}, la variante A a été envoyée par défaut au reste des destinataires.`
              : `Variante ${test.winner} retenue sur ${metric} le ${dateTimeFormat.format(test.decidedAt)}, envoyée au reste des destinataires.`
            : `${test.splitPercent} % des destinataires testent ; le reste reçoit la variante qui gagne sur ${metric} après ${test.windowHours} h${campaign.sendTimeOptimized ? ', comptées une fois la journée d’envois optimisés passée' : ''}.`}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-faint">
            <th className="py-1 font-medium">Variante</th>
            <th className="py-1 font-medium">Envoyés</th>
            <th className="py-1 font-medium">Ouvertures</th>
            <th className="py-1 font-medium">Clics</th>
          </tr>
        </thead>
        <tbody>
          {(['A', 'B'] as const).map((variant) => {
            const f = figures(variant);
            return (
              <tr key={variant} className="border-t border-border">
                <td className="py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded border border-border px-1.5 font-mono text-xs">
                      {variant}
                    </span>
                    <span className="truncate text-ink">{label(variant)}</span>
                    {test.winner === variant && (
                      <StatusBadge tone={test.decidedBy === 'fallback' ? 'gray' : 'green'}>
                        {test.decidedBy === 'fallback' ? 'Par défaut' : 'Gagnante'}
                      </StatusBadge>
                    )}
                  </span>
                </td>
                <td className="py-2 font-medium text-ink">{numberFormat.format(f.sent)}</td>
                <td className="py-2">{pct(f.opened, f.sent)}</td>
                <td className="py-2">{pct(f.clicked, f.sent)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
