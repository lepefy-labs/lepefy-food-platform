import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { IconArrowDown, IconArrowUp, IconArrowsSort } from '@tabler/icons-react';
import type { AdminTone } from '@/lib/admin/tokens';
import { cn } from '@/lib/utils/cn';
import { TONE_SOLID_BG_CLASS } from '../ui/Badge';
import { RowCheckbox, SelectAllCheckbox } from './RowSelection';

export interface DataColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Tailwind width/min-width classes for the column. */
  className?: string;
  /** Hide below a breakpoint when a mobile card list is not used. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Server-side sort key; the header becomes a link. */
  sortKey?: string;
}

export interface DataRowGroup<Row> {
  id: string;
  label: ReactNode;
  tone?: AdminTone;
  rows: Row[];
}

export interface DataSort {
  key: string;
  direction: 'asc' | 'desc';
  /** Link that sorts by `key` (the page decides the next direction). */
  hrefFor: (key: string) => string;
}

interface DataTableProps<Row> {
  caption: string;
  columns: DataColumn<Row>[];
  rowKey: (row: Row) => string;
  rows?: Row[];
  /** Rows split under group headings (e.g. operational priority). */
  groups?: DataRowGroup<Row>[];
  /** Left stripe on a row that needs attention. */
  rowTone?: (row: Row) => AdminTone | undefined;
  /** Extra classes of a row (e.g. dimmed finished rows). */
  rowClassName?: (row: Row) => string | undefined;
  /** Requires a surrounding <RowSelectionProvider> (client). */
  selectable?: { label: (row: Row) => string };
  sort?: DataSort;
  /** Card rendering below md; the table is hidden on phones when provided. */
  mobileCard?: (row: Row) => ReactNode;
  /** Expanded content under a row (rendered by the caller, e.g. detail). */
  rowDetail?: (row: Row) => ReactNode;
  empty?: ReactNode;
  density?: 'comfortable' | 'compact';
  className?: string;
}

const HIDE: Record<NonNullable<DataColumn<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell', '2xl': 'hidden 2xl:table-cell',
};
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function SortHeader({ column, sort }: { column: DataColumn<never>; sort: DataSort }) {
  const active = sort.key === column.sortKey;
  const Icon = !active ? IconArrowsSort : sort.direction === 'asc' ? IconArrowUp : IconArrowDown;
  return (
    <Link href={sort.hrefFor(column.sortKey!)} scroll={false} className={cn('inline-flex items-center gap-1 rounded hover:text-a-text', active && 'text-a-text')}>
      {column.header}<Icon size={14} aria-hidden="true" className={active ? 'text-a-brand-fg' : 'text-a-text-3'} />
    </Link>
  );
}

/**
 * Admin data table. Server-compatible (no hooks): rows are rendered where the
 * data is loaded; sorting, filtering and pagination happen on the server
 * through the URL. Selection checkboxes are small client islands.
 */
export default function DataTable<Row>({
  caption, columns, rowKey, rows, groups, rowTone, rowClassName, selectable, sort, mobileCard, rowDetail, empty, density = 'comfortable', className,
}: DataTableProps<Row>) {
  const allGroups: DataRowGroup<Row>[] = groups ?? [{ id: 'all', label: null, rows: rows ?? [] }];
  const allRows = allGroups.flatMap((group) => group.rows);
  const ids = allRows.map(rowKey);
  const pad = density === 'compact' ? 'px-3 py-2' : 'px-3 py-3';
  const colSpan = columns.length + (selectable ? 1 : 0);

  if (allRows.length === 0) return <>{empty}</>;

  return (
    <div className={className}>
      <div className={cn('overflow-x-auto', mobileCard && 'hidden md:block')}>
        <table className="w-full border-separate border-spacing-0 text-sm text-a-text">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {selectable && <th scope="col" className="w-10 border-b border-a-border bg-a-surface-2 px-3 py-2 text-left"><SelectAllCheckbox ids={ids} /></th>}
              {columns.map((column) => {
                const sorted = sort && column.sortKey && sort.key === column.sortKey;
                return (
                  <th key={column.key} scope="col"
                    aria-sort={sorted ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('whitespace-nowrap border-b border-a-border bg-a-surface-2 px-3 py-2 text-xs font-semibold text-a-text-2', ALIGN[column.align ?? 'left'], column.hideBelow && HIDE[column.hideBelow], column.className)}>
                    {sort && column.sortKey ? <SortHeader column={column as DataColumn<never>} sort={sort} /> : column.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {allGroups.map((group) => (
              <Fragment key={group.id}>
                {group.label !== null && group.rows.length > 0 && (
                  <tr>
                    <th scope="colgroup" colSpan={colSpan} className="border-b border-a-border bg-a-surface-2 px-3 py-1.5 text-left text-xs font-semibold text-a-text-2">
                      <span className="inline-flex items-center gap-2">
                        {group.tone && <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', TONE_SOLID_BG_CLASS[group.tone])} />}
                        {group.label}<span className="font-normal text-a-text-3">· {group.rows.length}</span>
                      </span>
                    </th>
                  </tr>
                )}
                {group.rows.map((row) => {
                  const id = rowKey(row);
                  const tone = rowTone?.(row);
                  const detail = rowDetail?.(row);
                  return (
                    <Fragment key={id}>
                      <tr className={cn('group/row hover:bg-a-hover', rowClassName?.(row))}>
                        {selectable && (
                          <td className={cn('relative w-10 border-b border-a-border align-top', pad)}>
                            {tone && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_SOLID_BG_CLASS[tone])} />}
                            <RowCheckbox id={id} label={selectable.label(row)} />
                          </td>
                        )}
                        {columns.map((column, index) => (
                          <td key={column.key} className={cn('relative border-b border-a-border align-top', pad, ALIGN[column.align ?? 'left'], column.align === 'right' && 'tabular-nums', column.hideBelow && HIDE[column.hideBelow], column.className)}>
                            {!selectable && index === 0 && tone && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_SOLID_BG_CLASS[tone])} />}
                            {column.cell(row)}
                          </td>
                        ))}
                      </tr>
                      {detail && (
                        <tr>
                          <td colSpan={colSpan} className="border-b border-a-border bg-a-surface-2 p-0">{detail}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {mobileCard && (
        <div className="md:hidden">
          {allGroups.map((group) => group.rows.length > 0 && (
            <section key={group.id} aria-label={typeof group.label === 'string' ? group.label : undefined}>
              {group.label !== null && (
                <h3 className="flex items-center gap-2 border-b border-a-border bg-a-surface-2 px-3 py-1.5 text-xs font-semibold text-a-text-2">
                  {group.tone && <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', TONE_SOLID_BG_CLASS[group.tone])} />}
                  {group.label}<span className="font-normal text-a-text-3">· {group.rows.length}</span>
                </h3>
              )}
              <ul className="divide-y divide-a-border">
                {group.rows.map((row) => {
                  const tone = rowTone?.(row);
                  return (
                    <li key={rowKey(row)} className="relative">
                      {tone && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_SOLID_BG_CLASS[tone])} />}
                      {mobileCard(row)}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
