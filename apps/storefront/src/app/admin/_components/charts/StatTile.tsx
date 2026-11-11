import type { ReactNode } from 'react';
import { IconArrowDownRight, IconArrowUpRight, IconMinus } from '@tabler/icons-react';
import type { Delta } from '@/lib/admin/salesStatistics';
import { cn } from '@/lib/utils/cn';

/** 12-ish point trend, de-emphasised wash + 2 px line + end dot. Decorative: the value is in the tile. */
export function Sparkline({ values, color, width = 112, height = 32 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2 || values.every((value) => value === 0)) return null;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (index: number) => 2 + (index / (values.length - 1)) * (width - 6);
  const y = (value: number) => height - 3 - ((value - min) / span) * (height - 8);
  const line = values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0">
      <path d={`${line} L${x(last).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`} style={{ fill: color, opacity: 0.1 }} />
      <path d={line} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: color }} />
      <circle cx={x(last)} cy={y(values[last]!)} r={3} style={{ fill: color }} />
    </svg>
  );
}

const DELTA_ICON = { up: IconArrowUpRight, down: IconArrowDownRight, flat: IconMinus } as const;

/**
 * KPI tile of a statistics page: label, big tabular value, optional trend
 * and a variation chip whose tone says whether the change is good (shape +
 * sign + word, never colour alone).
 */
export default function StatTile({ label, value, delta, upIsGood = true, comparison, trend, children }: {
  label: string;
  value: string;
  delta?: Delta | null;
  upIsGood?: boolean;
  /** « vs 103 € les 30 j précédents ». */
  comparison?: ReactNode;
  trend?: ReactNode;
  children?: ReactNode;
}) {
  const good = delta && delta.direction !== 'flat' ? (delta.direction === 'up') === upIsGood : null;
  const DeltaIcon = delta ? DELTA_ICON[delta.direction] : null;
  return (
    <article className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-a-border bg-a-surface p-4">
      <h3 className="truncate text-sm font-semibold text-a-text-2">{label}</h3>
      <div className="flex items-end justify-between gap-2">
        <p className="min-w-0 truncate text-2xl font-bold tabular-nums tracking-tight text-a-text sm:text-[28px] sm:leading-9">{value}</p>
        {trend}
      </div>
      {children}
      {(delta || comparison) && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-a-text-3">
          {delta && DeltaIcon && (
            <span className={cn('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold tabular-nums',
              good === null ? 'bg-tone-neutral-bg text-tone-neutral-fg' : good ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-danger-bg text-tone-danger-fg')}>
              <DeltaIcon size={14} stroke={2.2} aria-hidden="true" />
              <span className="sr-only">{delta.direction === 'up' ? 'En hausse : ' : delta.direction === 'down' ? 'En baisse : ' : 'Stable : '}</span>
              {delta.label}
            </span>
          )}
          {comparison}
        </p>
      )}
    </article>
  );
}
