import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { IconArrowDown, IconArrowUp, IconArrowsSort, IconChevronDown, type Icon as TablerIcon } from '@tabler/icons-react';
import type { AdminTone } from '@/lib/admin/tokens';
import { cn } from '@/lib/utils/cn';
import { TONE_BADGE_CLASS, TONE_SOLID_BG_CLASS } from '../ui/Badge';
import { RowCheckbox, SelectAllCheckbox } from './RowSelection';

export interface DataColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Tailwind width/min-width classes for the column. */
  className?: string;
  /** Hide below a breakpoint when a mobile card list is not used. */
  /** `wide`: from 1760 px, for tables next to the expanded sidebar. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'wide';
  /** Server-side sort key; the header becomes a link. */
  sortKey?: string;
}

export interface DataRowGroup<Row> {
  id: string;
  label: ReactNode;
  tone?: AdminTone;
  rows: Row[];
  /** Collapsible group (controlled by a client caller): rows are not rendered while collapsed. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** `queue` variant: icon of the group header. */
  icon?: TablerIcon;
  /** `queue` variant: size of the whole group when the page shows only part of it. */
  total?: number;
  /** `queue` variant: short note after the count (e.g. « 4 sur cette page »). */
  note?: ReactNode;
}

function GroupHeading<Row>({ group }: { group: DataRowGroup<Row> }) {
  const content = <>
    {group.tone && <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', TONE_SOLID_BG_CLASS[group.tone])} />}
    {group.label}<span className="font-normal text-a-text-3">· {group.rows.length}</span>
  </>;
  if (!group.onToggle) return <span className="inline-flex items-center gap-2">{content}</span>;
  return (
    <button type="button" onClick={group.onToggle} aria-expanded={!group.collapsed}
      className="-mx-1 inline-flex min-h-8 items-center gap-2 rounded px-1 hover:text-a-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
      {content}
      <span className="inline-flex items-center gap-0.5 font-semibold text-a-brand-fg">
        {group.collapsed ? 'Afficher' : 'Masquer'}
        <IconChevronDown size={14} aria-hidden="true" className={cn('transition-transform', !group.collapsed && 'rotate-180')} />
      </span>
    </button>
  );
}

/**
 * Header of a work-queue group (`variant="queue"`): band tinted in the group's
 * tone, icon, bold title, visible count and a full-width toggle with
 * `aria-expanded`. The tone is never the only signal: icon, title and count
 * carry the same meaning.
 */
function QueueGroupHeading<Row>({ group }: { group: DataRowGroup<Row> }) {
  const Icon = group.icon;
  const count = group.total ?? group.rows.length;
  const classes = cn('flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left', TONE_BADGE_CLASS[group.tone ?? 'neutral']);
  const content = (
    <span className="flex min-w-0 items-center gap-2.5">
      {Icon && <Icon size={20} stroke={1.8} aria-hidden="true" className="shrink-0" />}
      <span className="truncate text-base font-semibold">{group.label}</span>
      <span className="shrink-0 rounded-full bg-a-surface px-2 text-sm font-semibold tabular-nums text-a-text">{count}</span>
      {group.note && <span className="hidden truncate text-xs font-normal text-a-text-2 sm:inline">{group.note}</span>}
    </span>
  );
  if (!group.onToggle) return <div className={classes}>{content}</div>;
  return (
    <button type="button" onClick={group.onToggle} aria-expanded={!group.collapsed}
      className={cn(classes, 'min-h-11 hover:border-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus')}>
      {content}
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
        <span className="hidden sm:inline">{group.collapsed ? 'Afficher' : 'Masquer'}</span>
        <IconChevronDown size={18} aria-hidden="true" className={cn('transition-transform', !group.collapsed && 'rotate-180')} />
      </span>
    </button>
  );
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
  /**
   * Mouse shortcut on the whole row (e.g. toggle its detail). Clicks on links,
   * buttons, form controls or while selecting text are ignored; keyboard users
   * keep the row's own button.
   */
  onRowClick?: (row: Row) => void;
  empty?: ReactNode;
  density?: 'comfortable' | 'compact';
  /**
   * `queue`: operational work queue (Admin → Commandes). Tinted group headers
   * with icon and count, space between groups, stronger row separators, a
   * wider attention stripe, the open detail framed under its own row, and
   * mobile cards as separate tiles. `default` is unchanged.
   */
  variant?: 'default' | 'queue';
  className?: string;
}

const HIDE: Record<NonNullable<DataColumn<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell', '2xl': 'hidden 2xl:table-cell', wide: 'hidden min-[1760px]:table-cell',
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
  caption, columns, rowKey, rows, groups, rowTone, rowClassName, selectable, sort, mobileCard, rowDetail, onRowClick, empty, density = 'comfortable', variant = 'default', className,
}: DataTableProps<Row>) {
  const queue = variant === 'queue';
  const allGroups: DataRowGroup<Row>[] = groups ?? [{ id: 'all', label: null, rows: rows ?? [] }];
  const allRows = allGroups.flatMap((group) => group.rows);
  // Select-all only covers rows on screen, never those of a collapsed group.
  const ids = allGroups.flatMap((group) => (group.collapsed ? [] : group.rows)).map(rowKey);
  const pad = density === 'compact' ? 'px-3 py-2' : queue ? 'px-3 py-3.5' : 'px-3 py-3';
  // Work queue: stronger separator and wider stripe, so adjacent orders never read as one surface.
  const rowBorder = queue ? 'border-b border-a-border-strong' : 'border-b border-a-border';
  const stripe = queue ? 'w-1' : 'w-[3px]';
  const colSpan = columns.length + (selectable ? 1 : 0);
  const firstGroupId = allGroups.find((group) => group.label !== null && group.rows.length > 0)?.id;

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
                {group.label !== null && group.rows.length > 0 && (queue ? (
                  <tr>
                    {/* Space above every group but the first: sections read as separate blocks. */}
                    <th scope="colgroup" colSpan={colSpan} className={cn('px-2 pb-2 text-left font-normal', group.id === firstGroupId ? 'pt-2' : 'pt-6')}>
                      <QueueGroupHeading group={group} />
                    </th>
                  </tr>
                ) : (
                  <tr>
                    <th scope="colgroup" colSpan={colSpan} className="border-b border-a-border bg-a-surface-2 px-3 py-1.5 text-left text-xs font-semibold text-a-text-2">
                      <GroupHeading group={group} />
                    </th>
                  </tr>
                ))}
                {!group.collapsed && group.rows.map((row, rowIndex) => {
                  const id = rowKey(row);
                  const tone = rowTone?.(row);
                  const detail = rowDetail?.(row);
                  const last = rowIndex === group.rows.length - 1;
                  // Queue: orders are separated by a band (below), so only the last one closes the group with a line;
                  // an open row and its detail share one background and one bottom separator.
                  const cellBorder = queue ? (detail || !last ? '' : rowBorder) : rowBorder;
                  return (
                    <Fragment key={id}>
                      {queue && rowIndex > 0 && (
                        // Band in the page colour between two orders of the same group: each order reads as its own block.
                        <tr aria-hidden="true" role="presentation">
                          <td colSpan={colSpan} className="h-2 border-y border-a-border-strong bg-a-bg p-0" />
                        </tr>
                      )}
                      <tr className={cn('group/row', queue && detail ? 'bg-a-surface-2' : 'hover:bg-a-hover', onRowClick && 'cursor-pointer', rowClassName?.(row))}
                        onClick={onRowClick ? (event) => {
                          if ((event.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="button"]')) return;
                          if (window.getSelection()?.toString()) return;
                          onRowClick(row);
                        } : undefined}>
                        {selectable && (
                          <td className={cn('relative w-10 align-top', cellBorder, pad)}>
                            {tone && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0', stripe, TONE_SOLID_BG_CLASS[tone])} />}
                            <RowCheckbox id={id} label={selectable.label(row)} />
                          </td>
                        )}
                        {columns.map((column, index) => (
                          <td key={column.key} className={cn('relative align-top', cellBorder, pad, ALIGN[column.align ?? 'left'], column.align === 'right' && 'tabular-nums', column.hideBelow && HIDE[column.hideBelow], column.className)}>
                            {!selectable && index === 0 && tone && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0', stripe, TONE_SOLID_BG_CLASS[tone])} />}
                            {column.cell(row)}
                          </td>
                        ))}
                      </tr>
                      {detail && (queue ? (
                        <tr>
                          {/* Framed on the row's background, with its stripe: the detail visibly belongs to the order above. */}
                          <td colSpan={colSpan} className={cn('relative bg-a-surface-2 px-3 pb-3 pt-0', last && rowBorder)}>
                            {tone && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0', stripe, TONE_SOLID_BG_CLASS[tone])} />}
                            <div className="rounded-lg border border-a-border bg-a-surface">{detail}</div>
                          </td>
                        </tr>
                      ) : (
                        <tr>
                          <td colSpan={colSpan} className="border-b border-a-border bg-a-surface-2 p-0">{detail}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {mobileCard && (
        <div className={cn('md:hidden', queue && 'space-y-4 px-2 py-3')}>
          {allGroups.map((group) => group.rows.length > 0 && (queue ? (
            <section key={group.id} aria-label={typeof group.label === 'string' ? group.label : undefined}>
              {group.label !== null && <h3><QueueGroupHeading group={group} /></h3>}
              {!group.collapsed && <ul className={cn('space-y-2', group.label !== null && 'mt-2')}>
                {group.rows.map((row) => {
                  const tone = rowTone?.(row);
                  return (
                    <li key={rowKey(row)} className="relative overflow-hidden rounded-lg border border-a-border-strong bg-a-surface">
                      {tone && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0', stripe, TONE_SOLID_BG_CLASS[tone])} />}
                      {mobileCard(row)}
                    </li>
                  );
                })}
              </ul>}
            </section>
          ) : (
            <section key={group.id} aria-label={typeof group.label === 'string' ? group.label : undefined}>
              {group.label !== null && (
                <h3 className="flex items-center gap-2 border-b border-a-border bg-a-surface-2 px-3 py-1.5 text-xs font-semibold text-a-text-2">
                  <GroupHeading group={group} />
                </h3>
              )}
              {!group.collapsed && <ul className="divide-y divide-a-border">
                {group.rows.map((row) => {
                  const tone = rowTone?.(row);
                  return (
                    <li key={rowKey(row)} className="relative">
                      {tone && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_SOLID_BG_CLASS[tone])} />}
                      {mobileCard(row)}
                    </li>
                  );
                })}
              </ul>}
            </section>
          )))}
        </div>
      )}
    </div>
  );
}
