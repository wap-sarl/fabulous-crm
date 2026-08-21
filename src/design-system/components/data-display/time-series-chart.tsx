import { cn } from '../../theme/utils';

interface TimeSeriesPoint {
  label: string;
  value: number;
}

interface TimeSeriesChartProps {
  series: TimeSeriesPoint[];
  /** Line + dot color. @default 'var(--chart-1)' */
  color?: string;
  /** Area fill under the line. @default 'rgba(106,75,240,.09)' */
  areaColor?: string;
  className?: string;
}

const VIEW_W = 820;
const VIEW_H = 250;
const PAD_X = 14;
const PAD_TOP = 16;
const PAD_BOTTOM = 34;

/**
 * Hand-rolled responsive SVG line chart with gridlines, area fill, dots and
 * mono x-axis labels — no chart library.
 */
function TimeSeriesChart({
  series,
  color = 'var(--chart-1)',
  areaColor = 'rgba(106,75,240,.09)',
  className,
}: TimeSeriesChartProps) {
  if (series.length === 0) {
    return (
      <div className={cn('py-8 text-center text-sm text-faint', className)}>
        Pas encore de données
      </div>
    );
  }

  const max = Math.max(...series.map((p) => p.value), 1);
  const innerW = VIEW_W - PAD_X * 2;
  const innerH = VIEW_H - PAD_TOP - PAD_BOTTOM;

  const coords = series.map((point, i) => ({
    x: PAD_X + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW),
    y: PAD_TOP + innerH - (point.value / max) * innerH,
    label: point.label,
  }));

  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${PAD_X},${PAD_TOP + innerH} ${line} ${PAD_X + innerW},${PAD_TOP + innerH}`;
  const gridYs = [0, 1, 2, 3].map((i) => PAD_TOP + (i / 3) * innerH);

  // Avoid label overlap on dense series: keep ~8 evenly spread labels.
  const labelStep = Math.max(1, Math.ceil(series.length / 8));

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className={cn('h-auto w-full', className)} role="img">
      {gridYs.map((y) => (
        <line
          key={y}
          x1={PAD_X}
          x2={VIEW_W - PAD_X}
          y1={y}
          y2={y}
          stroke="#EEF0F3"
          strokeWidth={1}
        />
      ))}
      <polygon points={area} fill={areaColor} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r={3} fill="#fff" stroke={color} strokeWidth={2} />
          {i % labelStep === 0 && (
            <text
              x={c.x}
              y={VIEW_H - 12}
              textAnchor="middle"
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="#98A0AD"
            >
              {c.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export { TimeSeriesChart };
export type { TimeSeriesChartProps, TimeSeriesPoint };
