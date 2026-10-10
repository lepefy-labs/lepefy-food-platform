import type { ReactNode } from 'react';
import type { AdminTone } from '@/lib/admin/tokens';
import { cn } from '@/lib/utils/cn';

// Literal class names: Tailwind only generates classes it can read in source.
export const TONE_BADGE_CLASS: Record<AdminTone, string> = {
  info: 'border-tone-info-border bg-tone-info-bg text-tone-info-fg',
  success: 'border-tone-success-border bg-tone-success-bg text-tone-success-fg',
  warning: 'border-tone-warning-border bg-tone-warning-bg text-tone-warning-fg',
  urgent: 'border-tone-urgent-border bg-tone-urgent-bg text-tone-urgent-fg',
  danger: 'border-tone-danger-border bg-tone-danger-bg text-tone-danger-fg',
  neutral: 'border-tone-neutral-border bg-tone-neutral-bg text-tone-neutral-fg',
};

export const TONE_SOLID_BG_CLASS: Record<AdminTone, string> = {
  info: 'bg-tone-info-solid',
  success: 'bg-tone-success-solid',
  warning: 'bg-tone-warning-solid',
  urgent: 'bg-tone-urgent-solid',
  danger: 'bg-tone-danger-solid',
  neutral: 'bg-tone-neutral-solid',
};

export type BadgeTone = AdminTone | 'brand';

interface BadgeProps {
  tone?: BadgeTone;
  /** A leading dot marks a state; omit it for attributes (« Frais », « Payé · carte »). */
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Admin badge: semantic tone, never colour alone (always a text label). */
export default function Badge({ tone = 'neutral', dot = false, icon, className, children }: BadgeProps) {
  const toneClass = tone === 'brand' ? 'border-transparent bg-a-brand-soft text-a-brand-fg' : TONE_BADGE_CLASS[tone];
  return (
    <span className={cn('inline-flex min-h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-semibold', toneClass, className)}>
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {icon}
      {children}
    </span>
  );
}

/** Small numeric counter (sidebar, tabs). */
export function CountBadge({ tone = 'neutral', count, label }: { tone?: BadgeTone; count: number; label?: string }) {
  if (count <= 0) return null;
  const toneClass = tone === 'brand' ? 'bg-a-brand-soft text-a-brand-fg' : TONE_BADGE_CLASS[tone];
  return (
    <span aria-label={label} className={cn('inline-flex min-w-5 items-center justify-center rounded-full border border-transparent px-1.5 text-xs font-semibold leading-5 tabular-nums', toneClass)}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
