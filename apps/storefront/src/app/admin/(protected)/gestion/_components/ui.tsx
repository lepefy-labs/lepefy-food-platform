import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Tone } from '@/lib/gestion/domain';

/** Primitive visive di Gestion (server e client), coerenti con il design system admin. */

export const CARD_CLS = 'rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
export const INPUT_CLS =
  'min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const LABEL_CLS = 'mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200';
export const HINT_CLS = 'mt-1.5 text-xs leading-5 text-gray-500 dark:text-gray-400';
export const PRIMARY_LINK_CLS =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--color-primary-dark)] px-4 text-sm font-medium text-white hover:opacity-90';
export const SECONDARY_LINK_CLS =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

const TONE_CLS: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  info: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-900',
  warn: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900',
  success: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900',
  danger: 'bg-red-50 text-red-800 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900',
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLS[tone]}`}>{children}</span>;
}

export function Panel({ id, title, description, actions, children }: {
  id?: string; title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={`${CARD_CLS} scroll-mt-24 overflow-hidden`}>
      <header className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:border-gray-800">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-gray-950 dark:text-gray-100">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'neutral', href }: {
  label: string; value: string; hint?: string; tone?: Tone; href?: string;
}) {
  const accent: Record<Tone, string> = {
    neutral: 'text-gray-950 dark:text-gray-100',
    info: 'text-sky-700 dark:text-sky-300',
    warn: 'text-amber-700 dark:text-amber-300',
    success: 'text-emerald-700 dark:text-emerald-300',
    danger: 'text-red-700 dark:text-red-300',
  };
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${accent[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </>
  );
  return href
    ? <Link href={href} className={`${CARD_CLS} block px-4 py-3.5 transition hover:border-[var(--admin-primary)]`}>{inner}</Link>
    : <div className={`${CARD_CLS} px-4 py-3.5`}>{inner}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center dark:border-gray-700">
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-0.5 break-words text-sm text-gray-900 dark:text-gray-100">{children}</div>
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="mb-2 text-sm text-gray-500 dark:text-gray-400">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {index > 0 && <span aria-hidden="true">/</span>}
            {item.href
              ? <Link href={item.href} className="rounded hover:text-gray-900 dark:hover:text-gray-100">{item.label}</Link>
              : <span className="text-gray-700 dark:text-gray-300">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
