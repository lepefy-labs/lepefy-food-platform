import type { ReactNode } from 'react';
import { IconAlertOctagon, IconInbox, IconSearchOff } from '@tabler/icons-react';
import { cn } from '@/lib/utils/cn';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** « filtered » = no row matches the filters (offer a reset), « empty » = nothing exists yet. */
  variant?: 'empty' | 'filtered';
  action?: ReactNode;
  className?: string;
}

/** Empty list or panel: says why it is empty and what to do next. */
export function EmptyState({ title, description, variant = 'empty', action, className }: EmptyStateProps) {
  const Icon = variant === 'filtered' ? IconSearchOff : IconInbox;
  return (
    <div className={cn('flex flex-col items-center px-4 py-10 text-center', className)}>
      <span aria-hidden="true" className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-a-surface-2 text-a-text-3"><Icon size={22} stroke={1.6} /></span>
      <p className="text-sm font-semibold text-a-text">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-a-text-2">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Data that could not be loaded: what failed and a way to retry. */
export function ErrorState({ title = 'Impossible de charger les données.', description, action, className }: { title?: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center px-4 py-10 text-center', className)}>
      <span aria-hidden="true" className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-tone-danger-bg text-tone-danger-fg"><IconAlertOctagon size={22} stroke={1.6} /></span>
      <p className="text-sm font-semibold text-a-text">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-a-text-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded-md bg-a-surface-2 motion-reduce:animate-none', className)} />;
}

/** Placeholder of a list page while the server renders it (loading.tsx). */
export function ListPageSkeleton({ kpis = 0, rows = 8 }: { kpis?: number; rows?: number }) {
  return (
    <div role="status" aria-label="Chargement…" className="mx-auto w-full max-w-7xl">
      <Skeleton className="mb-2 h-3 w-32" />
      <Skeleton className="mb-5 h-7 w-56" />
      {kpis > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: kpis }, (_, index) => <Skeleton key={index} className="h-[84px] rounded-[10px]" />)}
        </div>
      )}
      <div className="overflow-hidden rounded-[10px] border border-a-border bg-a-surface">
        <div className="flex gap-2 border-b border-a-border p-2.5"><Skeleton className="h-9 w-64" /><Skeleton className="h-9 flex-1" /></div>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-a-border px-3 py-3.5 last:border-0">
            <Skeleton className="h-4 w-4" /><Skeleton className="h-4 w-40" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
