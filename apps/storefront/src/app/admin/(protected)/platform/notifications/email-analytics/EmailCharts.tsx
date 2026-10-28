import type { DayPoint } from '@/lib/notifications/brevoAnalytics';

/** Server-rendered SVG charts (no chart library in the project); every value is also in a <title> and a text summary. */

interface SeriesDef { key: 'sent' | 'delivered' | 'firstOpen' | 'clicked'; label: string; color: string }

const W = 720;
const H = 220;
const PAD = { left: 40, right: 12, top: 12, bottom: 28 };

export function TrendChart({ points, series, label }: { points: DayPoint[]; series: SeriesDef[]; label: string }) {
  const max = Math.max(1, ...points.flatMap((point) => series.map((item) => point[item.key])));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (points.length <= 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;
  const tickEvery = Math.max(1, Math.ceil(points.length / 8));
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH * ratio} y2={PAD.top + plotH * ratio} stroke="currentColor" className="text-a-border" strokeDasharray="3 5" />
            <text x={PAD.left - 6} y={PAD.top + plotH * ratio + 4} textAnchor="end" fontSize="10" fill="currentColor" className="text-a-text-3">{Math.round(max * (1 - ratio))}</text>
          </g>
        ))}
        {points.map((point, index) => index % tickEvery === 0 && (
          <text key={point.day} x={x(index)} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor" className="text-a-text-3">{point.day.slice(5)}</text>
        ))}
        {series.map((item) => (
          <g key={item.key}>
            <polyline fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" points={points.map((point, index) => `${x(index).toFixed(1)},${y(point[item.key]).toFixed(1)}`).join(' ')} />
            {points.length <= 45 && points.map((point, index) => (
              <circle key={point.day} cx={x(index)} cy={y(point[item.key])} r="3" fill={item.color}><title>{`${point.day} · ${item.label} : ${point[item.key]}`}</title></circle>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-a-text-2">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: item.color }} />
            {item.label} · {points.reduce((sum, point) => sum + point[item.key], 0)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function BarList({ items, color, empty }: { items: Array<{ label: string; value: number }>; color: string; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-a-text-3">{empty}</p>;
  const max = Math.max(1, ...items.map((item) => item.value));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-a-text-2">{item.label}</span>
            <span className="tabular-nums text-a-text">{item.value}<span className="ml-1 text-xs text-a-text-3">({Math.round((item.value / total) * 100)} %)</span></span>
          </div>
          <div className="mt-1 h-2 rounded bg-a-surface-2" aria-hidden="true">
            <div className="h-2 rounded" style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, backgroundColor: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
