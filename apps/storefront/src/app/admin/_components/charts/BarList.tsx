import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { CHART_MUTED } from './chartTheme';

export interface BarListItem {
  key: string;
  label: string;
  /** Bar length (relative to the largest item). */
  value: number;
  valueLabel: string;
  /** Muted text after the value (« · 34 % », « 5 vendus »). */
  detail?: string;
  leading?: ReactNode;
  href?: string;
  /** Folded remainder (« Autres (3) »): muted bar. */
  other?: boolean;
}

/**
 * Ranked horizontal bars: label above or beside, value at the bar's tip,
 * 4 px rounded data end. `ranked` adds a position chip (top products).
 */
export default function BarList({ items, color, ranked = false, layout = 'inline', empty }: {
  items: BarListItem[];
  color: string;
  ranked?: boolean;
  /** inline = label | bar | value on one row (from sm); stacked = label + value above the bar. */
  layout?: 'inline' | 'stacked';
  empty: ReactNode;
}) {
  if (items.length === 0) return <div className="py-6 text-center text-sm text-a-text-3">{empty}</div>;
  const max = Math.max(...items.map((item) => item.value), 0) || 1;
  return (
    <ol className={cn('flex flex-col', layout === 'stacked' ? 'gap-3.5' : 'gap-3')}>
      {items.map((item, index) => {
        const width = `${Math.max(2, (item.value / max) * 100)}%`;
        const bar = (
          <div className="h-2.5 min-w-0 flex-1 rounded-r bg-a-surface-2" aria-hidden="true">
            <div className="h-2.5 rounded-r" style={{ width, background: item.other ? CHART_MUTED : color }} />
          </div>
        );
        const label = item.href
          ? <Link href={item.href} className="truncate hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">{item.label}</Link>
          : <span className="truncate">{item.label}</span>;
        const value = (
          <span className="shrink-0 text-right text-sm tabular-nums">
            <b className="font-semibold text-a-text">{item.valueLabel}</b>
            {item.detail && <span className="text-a-text-3"> · {item.detail}</span>}
          </span>
        );
        return (
          <li key={item.key} className="min-w-0">
            {layout === 'stacked' || ranked ? (
              <div className="flex min-w-0 items-center gap-3">
                {ranked && (
                  <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                    index < 3 ? 'bg-a-brand-soft text-a-brand-fg' : 'bg-a-surface-2 text-a-text-2')}>{index + 1}</span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm text-a-text">
                    <span className="flex min-w-0 items-center gap-2">{item.leading}{label}</span>
                    {value}
                  </div>
                  {bar}
                </div>
              </div>
            ) : (
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-sm text-a-text sm:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_auto]">
                <span className="flex min-w-0 items-center gap-2">{item.leading}{label}</span>
                <span className="col-span-2 row-start-2 flex sm:col-span-1 sm:row-start-auto">{bar}</span>
                <span className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">{value}</span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
