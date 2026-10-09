import Link from 'next/link';

type Tone = 'brand' | 'info' | 'warning' | 'danger' | 'success';
const styles: Record<Tone, string> = {
  brand: 'border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-100',
  info: 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100',
  warning: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100',
  danger: 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100',
};

/** Shared administrative KPI, clickable only when a destination is provided. */
export default function AdminStatCard({
  title, value, description, href, tone = 'brand', active = false,
}: {
  title: string;
  value: number | string;
  description?: string;
  href?: string;
  tone?: Tone;
  active?: boolean;
}) {
  const classes = `block min-h-[92px] rounded-xl border p-3 transition-shadow ${styles[tone]} ${active ? 'ring-2 ring-[var(--admin-primary)] ring-offset-2 dark:ring-offset-gray-950' : ''} ${href ? 'hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--admin-focus)]' : ''}`;
  const content = <>
    <div className="flex items-start justify-between gap-2">
      <span className="text-sm font-semibold">{title}</span>
      <strong className="rounded-lg bg-white/80 px-2 py-0.5 text-lg font-bold tabular-nums text-gray-950 dark:bg-gray-950/50 dark:text-white">{value}</strong>
    </div>
    {description && <p className="mt-2 text-xs leading-4 opacity-85">{description}</p>}
  </>;
  return href
    ? <Link href={href} aria-current={active ? 'page' : undefined} className={classes}>{content}</Link>
    : <div className={classes}>{content}</div>;
}
