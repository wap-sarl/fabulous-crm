import { cn } from '../../theme/utils';

interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
  /** Stroke color. @default 'var(--chart-1)' */
  color?: string;
  className?: string;
}

/**
 * Tiny trend polyline, no axes. Renders a muted "Pas encore de données"
 * placeholder when fewer than 2 points are provided.
 */
function Sparkline({
  points,
  width = 132,
  height = 34,
  color = 'var(--chart-1)',
  className,
}: SparklineProps) {
  if (points.length < 2) {
    return (
      <span className={cn('text-[11px] text-[#C4C8D2]', className)}>Pas encore de données</span>
    );
  }

  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const pad = 3;
  const svgPoints = points
    .map((value, i) => {
      const x = pad + (i / (points.length - 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <polyline
        points={svgPoints}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { Sparkline };
export type { SparklineProps };
