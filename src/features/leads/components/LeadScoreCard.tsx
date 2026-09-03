import { Card } from '@crm/design-system';
import { api } from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import { LeadScoreBadge } from './LeadScoreBadge';

interface LeadScoreCardProps {
  score: number | undefined;
  breakdown: Record<string, number> | undefined;
}

export function LeadScoreCard({ score, breakdown }: LeadScoreCardProps) {
  const rules = useAuthQuery(api.features.scoring.queries.listScoringRules, {});
  const contributions = breakdown ?? {};

  if (score === undefined && (rules === undefined || rules.length === 0)) return null;

  const known = (rules ?? []).filter((r) => contributions[r._id] !== undefined);
  const orphanIds = Object.keys(contributions).filter((id) => !known.some((r) => r._id === id));

  return (
    <Card className="p-5" data-testid="lead-score-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-ink">Détail du score</h2>
        <LeadScoreBadge score={score ?? 0} />
      </div>
      {known.length === 0 && orphanIds.length === 0 ? (
        <p className="text-sm text-faint">Aucune règle ne contribue au score.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {known.map((rule) => (
            <li key={rule._id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-body" title={rule.description ?? rule.name}>
                {rule.name}
              </span>
              <span
                className={
                  contributions[rule._id] >= 0
                    ? 'shrink-0 font-semibold text-success'
                    : 'shrink-0 font-semibold text-destructive'
                }
              >
                {contributions[rule._id] >= 0 ? '+' : ''}
                {contributions[rule._id]}
              </span>
            </li>
          ))}
          {orphanIds.map((id) => (
            <li key={id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-faint">Règle supprimée</span>
              <span className="shrink-0 font-semibold text-soft">
                {contributions[id] >= 0 ? '+' : ''}
                {contributions[id]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
