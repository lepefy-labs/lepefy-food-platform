/**
 * URL state of admin lists (search, filters, sort, pagination), typed once per
 * list and parsed on the server. Lists stay Server Components: the URL is the
 * only state, so links are shareable, the back button works and the server
 * always queries the full dataset.
 *
 *   const ORDER_LIST = defineListParams({
 *     q: { type: 'search' },
 *     status: { type: 'enum', values: ['new', 'preparing'] },
 *     from: { type: 'date' },
 *   }, { pageSizes: [25, 50, 100], defaultPageSize: 50 });
 *   const params = ORDER_LIST.parse(searchParams);
 *   const href = ORDER_LIST.href('/admin', params, { status: 'new' });
 */

export type RawSearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

export type ListParamSpec =
  | { type: 'search'; maxLength?: number }
  | { type: 'string'; maxLength?: number }
  | { type: 'enum'; values: readonly string[]; default?: string }
  | { type: 'date' }
  | { type: 'int'; min?: number; max?: number }
  | { type: 'bool' }
  | { type: 'uuid' };

type ValueOf<S extends ListParamSpec> =
  S extends { type: 'enum'; default: string } ? string
  : S extends { type: 'int' } ? number | undefined
  : S extends { type: 'bool' } ? boolean | undefined
  : string | undefined;

export type ListParamValues<Spec extends Record<string, ListParamSpec>> = { [K in keyof Spec]: ValueOf<Spec[K]> } & {
  page: number;
  pageSize: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function first(raw: RawSearchParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const value = raw[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseOne(spec: ListParamSpec, value: string | undefined): unknown {
  const trimmed = value?.trim();
  switch (spec.type) {
    case 'search': {
      // Keep letters (all scripts), digits and the few separators used in
      // names, e-mails, references and phone numbers.
      const cleaned = (trimmed ?? '').replace(/[^\p{L}\p{N}@._+\-# ]/gu, '').replace(/\s+/g, ' ').slice(0, spec.maxLength ?? 80).trim();
      return cleaned || undefined;
    }
    case 'string': return trimmed ? trimmed.slice(0, spec.maxLength ?? 120) : undefined;
    case 'enum': return trimmed && spec.values.includes(trimmed) ? trimmed : spec.default;
    case 'date': return trimmed && ISO_DATE.test(trimmed) && !Number.isNaN(Date.parse(trimmed)) ? trimmed : undefined;
    case 'int': {
      if (!trimmed || !/^-?\d+$/.test(trimmed)) return undefined;
      const n = Number.parseInt(trimmed, 10);
      if (spec.min !== undefined && n < spec.min) return undefined;
      if (spec.max !== undefined && n > spec.max) return undefined;
      return n;
    }
    case 'bool': return trimmed === 'true' ? true : trimmed === 'false' ? false : undefined;
    case 'uuid': return trimmed && UUID.test(trimmed) ? trimmed : undefined;
  }
}

function serializeOne(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export interface ListParamsOptions {
  pageSizes?: readonly number[];
  defaultPageSize?: number;
}

export function defineListParams<Spec extends Record<string, ListParamSpec>>(spec: Spec, options: ListParamsOptions = {}) {
  const pageSizes = options.pageSizes ?? [25, 50, 100];
  const defaultPageSize = options.defaultPageSize ?? pageSizes[0] ?? 25;
  const keys = Object.keys(spec) as (keyof Spec & string)[];

  function parse(raw: RawSearchParams): ListParamValues<Spec> {
    const values: Record<string, unknown> = {};
    for (const key of keys) values[key] = parseOne(spec[key] as ListParamSpec, first(raw, key));
    const page = Number.parseInt(first(raw, 'page') ?? '1', 10);
    const size = Number.parseInt(first(raw, 'size') ?? '', 10);
    values.page = Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1;
    values.pageSize = pageSizes.includes(size) ? size : defaultPageSize;
    return values as ListParamValues<Spec>;
  }

  /** Query string for a state; defaults are omitted to keep URLs short. */
  function query(values: Partial<ListParamValues<Spec>>): string {
    const params = new URLSearchParams();
    for (const key of keys) {
      const specDefault = (spec[key] as { default?: string }).default;
      const value = serializeOne(values[key]);
      if (value !== undefined && value !== specDefault) params.set(key, value);
    }
    if (values.pageSize && values.pageSize !== defaultPageSize) params.set('size', String(values.pageSize));
    if (values.page && values.page > 1) params.set('page', String(values.page));
    return params.toString();
  }

  /**
   * Link to the same list with some values changed. Any change other than the
   * page itself goes back to page 1 (a filtered list has fewer pages).
   */
  function href(pathname: string, current: ListParamValues<Spec>, patch: Partial<Record<keyof Spec | 'page' | 'pageSize', unknown>>): string {
    const touchesPage = 'page' in patch;
    const next = { ...current, ...patch, ...(touchesPage ? {} : { page: 1 }) } as ListParamValues<Spec>;
    const qs = query(next);
    return qs ? `${pathname}?${qs}` : pathname;
  }

  /** Number of active filters among `filterKeys` (search excluded by default). */
  function activeCount(values: ListParamValues<Spec>, filterKeys: (keyof Spec)[] = keys.filter((key) => (spec[key] as ListParamSpec).type !== 'search')): number {
    return filterKeys.filter((key) => {
      const specDefault = (spec[key] as { default?: string }).default;
      const value = values[key];
      return value !== undefined && value !== '' && value !== specDefault;
    }).length;
  }

  return { spec, keys, pageSizes, defaultPageSize, parse, query, href, activeCount };
}

export interface PageWindow {
  page: number;
  pageSize: number;
  pages: number;
  total: number;
  /** 1-based index of the first and last row shown (0 when empty). */
  from: number;
  to: number;
  /** Supabase .range() bounds (0-based, inclusive). */
  rangeFrom: number;
  rangeTo: number;
}

/** Clamp a requested page to the data and compute row bounds. */
export function pageWindow(total: number, page: number, pageSize: number): PageWindow {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const rangeFrom = (current - 1) * pageSize;
  return {
    page: current, pageSize, pages, total,
    from: total === 0 ? 0 : rangeFrom + 1,
    to: Math.min(current * pageSize, total),
    rangeFrom,
    rangeTo: rangeFrom + pageSize - 1,
  };
}

/** Page numbers to show around the current one; null = ellipsis. */
export function pageNumbers(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const set = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, index) => {
    if (index > 0 && n - (sorted[index - 1] ?? n) > 1) out.push(null);
    out.push(n);
  });
  return out;
}
