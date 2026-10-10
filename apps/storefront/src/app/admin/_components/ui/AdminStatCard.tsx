import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import type { AdminTone } from '@/lib/admin/tokens';
import { cn } from '@/lib/utils/cn';
import { TONE_SOLID_BG_CLASS } from './Badge';

type Tone = AdminTone | 'brand';

const STRIPE: Record<Tone, string> = { ...TONE_SOLID_BG_CLASS, brand: 'bg-a-brand' };

interface AdminStatCardProps {
  title: string;
  value: number | string;
  description?: ReactNode;
  /** When set, the card is a link (typically a filter of the list below). */
  href?: string;
  tone?: Tone;
  /** The filter this card represents is applied. */
  active?: boolean;
  icon?: ComponentType<{ size?: string | number; stroke?: string | number; className?: string; 'aria-hidden'?: boolean }>;
  /** Variation in % (e.g. month over month). */
  delta?: number | null;
}

/**
 * The only admin KPI card: neutral surface, tone stripe on the left, tabular
 * value. A zero value is dimmed so non-zero counts stand out.
 */
export default function AdminStatCard({ title, value, description, href, tone = 'neutral', active = false, icon: Icon, delta }: AdminStatCardProps) {
  const isZero = value === 0 || value === '0';
  const classes = cn(
    'relative block min-w-0 overflow-hidden rounded-[10px] border bg-a-surface py-2.5 pl-4 pr-3 transition-colors',
    active ? 'border-a-brand bg-a-selected ring-1 ring-a-brand' : 'border-a-border',
    href && 'hover:border-a-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus',
  );
  const content = (
    <>
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', STRIPE[tone])} />
      <span className="flex items-center gap-1.5 text-sm font-semibold text-a-text-2">
        {Icon && <Icon size={16} stroke={1.8} aria-hidden className="shrink-0" />}
        <span className="truncate">{title}</span>
      </span>
      <span className="mt-0.5 flex items-baseline gap-2">
        <span className={cn('text-2xl font-bold leading-7 tabular-nums', isZero ? 'text-a-text-3' : 'text-a-text')}>{value}</span>
        {delta != null && (
          <span className={cn('text-xs font-semibold tabular-nums', delta >= 0 ? 'text-tone-success-fg' : 'text-tone-danger-fg')}>
            {delta >= 0 ? '+' : '−'}{Math.abs(delta)} %
          </span>
        )}
      </span>
      {description && <span className="mt-0.5 block text-xs text-a-text-3">{description}</span>}
    </>
  );
  return href
    ? <Link href={href} aria-current={active ? 'true' : undefined} className={classes}>{content}</Link>
    : <div className={classes}>{content}</div>;
}
