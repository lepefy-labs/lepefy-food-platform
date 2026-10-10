import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export const cardClasses = 'rounded-[10px] border border-a-border bg-a-surface';

/** Card surface used by list and detail pages (no title). */
export function Card({ children, className, as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' }) {
  return <Tag className={cn('rounded-[10px] border border-a-border bg-a-surface', className)}>{children}</Tag>;
}

/** Titled section of a page: header with optional actions, padded body. */
export function Panel({ id, title, description, actions, children, flush = false, className }: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Body without padding (tables, lists). */
  flush?: boolean;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn('scroll-mt-20 overflow-hidden rounded-[10px] border border-a-border bg-a-surface', className)}>
      <header className="flex flex-col gap-2 border-b border-a-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-a-text">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-a-text-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </header>
      <div className={flush ? undefined : 'px-4 py-4'}>{children}</div>
    </section>
  );
}

/** Read-only label/value pairs (detail pages). */
export function DescriptionList({ children, columns = 2, className }: { children: ReactNode; columns?: 1 | 2 | 3; className?: string }) {
  return <dl className={cn('grid gap-x-6 gap-y-3', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3', className)}>{children}</dl>;
}

export function DescriptionItem({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-a-text-3">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-a-text">{children}</dd>
      {hint && <dd className="text-xs text-a-text-3">{hint}</dd>}
    </div>
  );
}

/** Label/value pair outside a <dl> (cards, grids). */
export function InfoField({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-a-text-3">{label}</p>
      <div className="mt-0.5 break-words text-sm text-a-text">{children}</div>
      {hint && <p className="text-xs text-a-text-3">{hint}</p>}
    </div>
  );
}
