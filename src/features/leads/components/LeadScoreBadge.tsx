import { StatusBadge, type StatusTone } from '@crm/design-system';

function toneOf(score: number): StatusTone {
  if (score >= 70) return 'green';
  if (score >= 40) return 'amber';
  if (score > 0) return 'blue';
  return 'gray';
}

/** Compact 0–100 score pill; undefined renders as a dash. */
export function LeadScoreBadge({ score }: { score: number | undefined }) {
  if (score === undefined) return <span className="text-xs text-placeholder">—</span>;
  return (
    <StatusBadge tone={toneOf(score)} withDot={false} title={`Score : ${score}/100`}>
      {score}
    </StatusBadge>
  );
}
