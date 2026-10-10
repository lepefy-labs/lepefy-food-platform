import Link from 'next/link';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { formatNumber } from '@/lib/admin/format';
import { pageNumbers, type PageWindow } from '@/lib/admin/listParams';
import { cn } from '@/lib/utils/cn';

interface PaginationProps {
  window: PageWindow;
  /** Link to a page of the same list (filters kept). */
  hrefForPage: (page: number) => string;
  /** Link for another page size; omit to hide the selector. */
  hrefForPageSize?: (size: number) => string;
  pageSizes?: readonly number[];
  /** Plural noun for the counter (« commandes »). */
  noun?: string;
  className?: string;
}

const cell = 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-sm tabular-nums';

/** Server-side pagination: plain links, works without JavaScript. */
export default function Pagination({ window: w, hrefForPage, hrefForPageSize, pageSizes = [25, 50, 100], noun = 'résultats', className }: PaginationProps) {
  return (
    <div className={cn('flex flex-col gap-2 border-t border-a-border px-3 py-2.5 text-sm text-a-text-2 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span aria-live="polite">
          {w.total === 0 ? `0 ${noun}` : <>{formatNumber(w.from)}–{formatNumber(w.to)} sur <b className="font-semibold text-a-text">{formatNumber(w.total)}</b> {noun}</>}
        </span>
        {hrefForPageSize && w.total > Math.min(...pageSizes) && (
          <span className="flex items-center gap-1">
            <span id="admin-page-size-label">Lignes par page</span>
            <span role="group" aria-labelledby="admin-page-size-label" className="flex gap-0.5">
              {pageSizes.map((size) => (
                <Link key={size} href={hrefForPageSize(size)} aria-current={size === w.pageSize ? 'true' : undefined}
                  className={cn('rounded-md px-1.5 py-0.5 tabular-nums', size === w.pageSize ? 'bg-a-selected font-semibold text-a-brand-fg' : 'hover:bg-a-hover hover:text-a-text')}>
                  {size}
                </Link>
              ))}
            </span>
          </span>
        )}
      </div>
      {w.pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          {w.page > 1
            ? <Link href={hrefForPage(w.page - 1)} aria-label="Page précédente" className={cn(cell, 'border-a-border bg-a-surface hover:bg-a-hover')}><IconChevronLeft size={16} aria-hidden="true" /></Link>
            : <span aria-hidden="true" className={cn(cell, 'border-a-border text-a-disabled-fg opacity-50')}><IconChevronLeft size={16} /></span>}
          {pageNumbers(w.page, w.pages).map((n, index) => n === null
            ? <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-a-text-3">…</span>
            : <Link key={n} href={hrefForPage(n)} aria-label={`Page ${n}`} aria-current={n === w.page ? 'page' : undefined}
                className={cn(cell, n === w.page ? 'border-a-brand bg-a-brand font-semibold text-a-on-brand' : 'border-a-border bg-a-surface hover:bg-a-hover')}>{n}</Link>)}
          {w.page < w.pages
            ? <Link href={hrefForPage(w.page + 1)} aria-label="Page suivante" className={cn(cell, 'border-a-border bg-a-surface hover:bg-a-hover')}><IconChevronRight size={16} aria-hidden="true" /></Link>
            : <span aria-hidden="true" className={cn(cell, 'border-a-border text-a-disabled-fg opacity-50')}><IconChevronRight size={16} /></span>}
        </nav>
      )}
    </div>
  );
}
