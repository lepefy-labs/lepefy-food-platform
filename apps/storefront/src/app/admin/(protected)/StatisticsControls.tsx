import Link from 'next/link';
import { IconCalendar, IconCheck } from '@tabler/icons-react';
import { CHANNEL_PARAM, PERIOD_LABELS, statisticsHref, type StatisticsQuery } from '@/lib/admin/salesStatistics';
import { cn } from '@/lib/utils/cn';
import { controlClasses, labelClasses } from '../_components/ui/Form';
import { buttonClasses } from '../_components/ui/Button';

export interface SegmentOption { key: string; label: string; href: string; active: boolean }

/** Pill group of links (URL state): one is current, every change is a navigation. */
export function SegmentedLinks({ label, options, size = 'md', className }: { label: string; options: SegmentOption[]; size?: 'sm' | 'md'; className?: string }) {
  return (
    <nav aria-label={label} className={cn('inline-flex max-w-full overflow-x-auto rounded-xl border border-a-border bg-a-surface p-1', className)}>
      {options.map((option) => (
        <Link key={option.key} href={option.href} scroll={false} prefetch={false} aria-current={option.active ? 'page' : undefined}
          className={cn('inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus',
            size === 'sm' ? 'min-h-8 px-2.5 text-xs' : 'min-h-9 px-3 text-sm',
            option.active ? 'bg-a-brand text-a-on-brand' : 'text-a-text-2 hover:bg-a-hover hover:text-a-text')}>
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

/** Period pills, custom dates (plain GET form, works without JS) and the comparison switch. */
export default function StatisticsControls({ query }: { query: StatisticsQuery }) {
  const periods = (Object.keys(PERIOD_LABELS) as Array<keyof typeof PERIOD_LABELS>).map((period) => ({
    key: period, label: PERIOD_LABELS[period].short, href: statisticsHref(query, { period }), active: query.period === period,
  }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedLinks label="Période" options={periods} />
      <details className="relative">
        <summary className={cn(buttonClasses({ variant: query.period === 'custom' ? 'primary' : 'secondary' }), 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
          <IconCalendar size={16} aria-hidden="true" />
          {query.period === 'custom' ? `${query.range.fromDay.split('-').reverse().join('/')} – ${query.range.toDay.split('-').reverse().join('/')}` : 'Dates'}
        </summary>
        <form action="/admin" method="get" className="absolute right-0 z-20 mt-2 flex w-72 flex-col gap-3 rounded-xl border border-a-border bg-a-surface p-4 shadow-lg">
          <input type="hidden" name="periode" value="custom" />
          {query.metric !== 'revenue' && <input type="hidden" name="indicateur" value={query.metric === 'orders' ? 'commandes' : 'panier'} />}
          {query.display === 'daily' && <input type="hidden" name="vue" value="jour" />}
          {!query.compare && <input type="hidden" name="comparer" value="0" />}
          {query.channel !== 'all' && <input type="hidden" name="canal" value={CHANNEL_PARAM[query.channel]} />}
          {query.heatChannel !== 'all' && <input type="hidden" name="moments" value={CHANNEL_PARAM[query.heatChannel]} />}
          <label className="flex flex-col gap-1">
            <span className={labelClasses}>Du</span>
            <input type="date" name="du" required defaultValue={query.range.fromDay} className={controlClasses} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClasses}>Au</span>
            <input type="date" name="au" required defaultValue={query.range.toDay} className={controlClasses} />
          </label>
          <button type="submit" className={buttonClasses({ variant: 'primary' })}>Afficher</button>
        </form>
      </details>
      <Link href={statisticsHref(query, { compare: !query.compare })} scroll={false} prefetch={false}
        className={cn(buttonClasses({ variant: 'secondary' }), 'gap-2')}>
        <span aria-hidden="true" className={cn('flex h-4 w-4 items-center justify-center rounded border', query.compare ? 'border-a-brand bg-a-brand text-a-on-brand' : 'border-a-field bg-a-surface')}>
          {query.compare && <IconCheck size={12} stroke={3} />}
        </span>
        <span>Comparer<span className="hidden sm:inline"> à la période précédente</span></span>
        <span className="sr-only">{query.compare ? ' (activé, cliquer pour désactiver)' : ' (désactivé, cliquer pour activer)'}</span>
      </Link>
    </div>
  );
}
