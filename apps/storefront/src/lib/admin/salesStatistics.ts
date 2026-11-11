/**
 * Pure rules of the « Statistiques » page (/admin): period from the URL,
 * previous period, bucket size, zero-filled series, comparisons and the
 * small read-models the charts receive. The aggregation itself runs in SQL
 * (RPC admin_sales_statistics, migration 181); this file never reads data.
 *
 * Every date is a shop-local calendar day (Europe/Paris, SHOP_TIME_ZONE):
 * a period is [from 00:00, to + 1 day 00:00) in shop time.
 */
import { shopLocalToIso, SHOP_TIME_ZONE } from '@/lib/time/shopTime';

/** Same rule as the SQL (documentation + tests): what makes an order count. */
export const COUNTED_ORDER_RULE = 'is_test = false, payment_status = paid, status <> cancelled';

export const STATISTICS_PERIODS = ['7j', '30j', '90j', '12m', 'custom'] as const;
export type StatisticsPeriod = (typeof STATISTICS_PERIODS)[number];
export type StatisticsBucket = 'day' | 'week' | 'month';
export type StatisticsMetric = 'revenue' | 'orders' | 'average';
export type StatisticsDisplay = 'cumulative' | 'daily';

export const PERIOD_LABELS: Record<Exclude<StatisticsPeriod, 'custom'>, { short: string; long: string }> = {
  '7j': { short: '7 j', long: '7 derniers jours' },
  '30j': { short: '30 j', long: '30 derniers jours' },
  '90j': { short: '90 j', long: '90 derniers jours' },
  '12m': { short: '12 mois', long: '12 derniers mois' },
};

/** Longest custom period (days): keeps the SQL bound (1 100 days) with margin. */
export const MAX_CUSTOM_DAYS = 1096;
/** Below this many orders, % variations are not shown (they mislead). */
export const LIMITED_DATA_ORDERS = 10;

export interface StatisticsRange {
  /** First shop-local day, YYYY-MM-DD (inclusive). */
  fromDay: string;
  /** Last shop-local day, YYYY-MM-DD (inclusive). */
  toDay: string;
  /** UTC instants of [fromDay 00:00, toDay + 1 00:00) in shop time. */
  fromIso: string;
  toIso: string;
  days: number;
}

export interface StatisticsQuery {
  period: StatisticsPeriod;
  range: StatisticsRange;
  previous: StatisticsRange;
  bucket: StatisticsBucket;
  compare: boolean;
  metric: StatisticsMetric;
  display: StatisticsDisplay;
  /** The custom dates were invalid and the default period was used. */
  invalidCustom: boolean;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

/** Shop-local calendar day of an instant, YYYY-MM-DD. */
export function shopDay(instant: Date, timeZone = SHOP_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Calendar arithmetic on YYYY-MM-DD (no time zone involved). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 + months, d!)).toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS);
}

function isValidDay(value: string): boolean {
  return DAY_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

export function rangeOf(fromDay: string, toDay: string): StatisticsRange {
  return {
    fromDay,
    toDay,
    fromIso: shopLocalToIso(`${fromDay}T00:00`)!,
    toIso: shopLocalToIso(`${addDays(toDay, 1)}T00:00`)!,
    days: daysBetween(fromDay, toDay) + 1,
  };
}

/** Same length, immediately before. */
export function previousRange(range: StatisticsRange): StatisticsRange {
  const toDay = addDays(range.fromDay, -1);
  return rangeOf(addDays(toDay, -(range.days - 1)), toDay);
}

export function bucketForDays(days: number): StatisticsBucket {
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

export function parseStatisticsQuery(params: Params, now: Date = new Date()): StatisticsQuery {
  const today = shopDay(now);
  const raw = first(params.periode);
  let period: StatisticsPeriod = (STATISTICS_PERIODS as readonly string[]).includes(raw) ? raw as StatisticsPeriod : '30j';
  let invalidCustom = false;
  let range: StatisticsRange;

  if (period === 'custom') {
    const du = first(params.du);
    const au = first(params.au);
    const valid = isValidDay(du) && isValidDay(au) && au >= du && daysBetween(du, au) + 1 <= MAX_CUSTOM_DAYS && du <= today;
    if (valid) range = rangeOf(du, au > today ? today : au);
    else { invalidCustom = true; period = '30j'; range = rangeOf(addDays(today, -29), today); }
  } else if (period === '12m') {
    // 12 calendar months: from the 1st of the month 11 months ago, so every bar is a whole month but the current one.
    range = rangeOf(`${addMonths(today, -11).slice(0, 7)}-01`, today);
  } else {
    const days = period === '7j' ? 7 : period === '90j' ? 90 : 30;
    range = rangeOf(addDays(today, -(days - 1)), today);
  }

  const metricRaw = first(params.indicateur);
  const metric: StatisticsMetric = metricRaw === 'commandes' ? 'orders' : metricRaw === 'panier' ? 'average' : 'revenue';
  const display: StatisticsDisplay = first(params.vue) === 'jour' ? 'daily' : 'cumulative';
  const compare = first(params.comparer) !== '0';
  const bucket: StatisticsBucket = period === '12m' ? 'month' : bucketForDays(range.days);

  return { period, range, previous: previousRange(range), bucket, compare, metric, display, invalidCustom };
}

/** URL of the page with some parameters changed; defaults are left out. */
export function statisticsHref(query: StatisticsQuery, patch: Partial<{ period: StatisticsPeriod; du: string; au: string; compare: boolean; metric: StatisticsMetric; display: StatisticsDisplay }>): string {
  const period = patch.period ?? query.period;
  const params = new URLSearchParams();
  if (period !== '30j') params.set('periode', period);
  if (period === 'custom') {
    params.set('du', patch.du ?? query.range.fromDay);
    params.set('au', patch.au ?? query.range.toDay);
  }
  const metric = patch.metric ?? query.metric;
  if (metric !== 'revenue') params.set('indicateur', metric === 'orders' ? 'commandes' : 'panier');
  if ((patch.display ?? query.display) === 'daily') params.set('vue', 'jour');
  if (!(patch.compare ?? query.compare)) params.set('comparer', '0');
  const search = params.toString();
  return search ? `/admin?${search}` : '/admin';
}

// ─── RPC result ────────────────────────────────────────────────────────────

export interface SalesTotals { orders: number; revenue: number; customers: number; newCustomers: number; returningCustomers: number; units: number }
export interface SeriesRow { bucket: string; orders: number; revenue: number }
export interface BreakdownRow { key: string | null; orders: number; revenue: number }
export interface CategoryRow { id: string | null; name: string | null; revenue: number; units: number }
export interface ProductRow { id: string | null; name: string; revenue: number; units: number }
export interface HeatmapRow { weekday: number; slot: number; orders: number }

export interface SalesStatistics {
  totals: SalesTotals;
  series: SeriesRow[];
  categories: CategoryRow[];
  products: ProductRow[];
  fulfillment: BreakdownRow[];
  paymentMethods: BreakdownRow[];
  countries: BreakdownRow[];
  heatmap: HeatmapRow[];
}

type Json = Record<string, unknown>;
const num = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
const rows = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((row): row is Json => !!row && typeof row === 'object') : []);

/** Normalises the jsonb of admin_sales_statistics (numbers may arrive as strings). */
export function normalizeSalesStatistics(raw: unknown): SalesStatistics {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Json;
  const totals = (data.totals && typeof data.totals === 'object' ? data.totals : {}) as Json;
  const breakdown = (value: unknown): BreakdownRow[] => rows(value).map((row) => ({ key: str(row.key), orders: num(row.orders), revenue: num(row.revenue) }));
  return {
    totals: {
      orders: num(totals.orders),
      revenue: num(totals.revenue),
      customers: num(totals.customers),
      newCustomers: num(totals.new_customers),
      returningCustomers: num(totals.returning_customers),
      units: num(totals.units),
    },
    series: rows(data.series).map((row) => ({ bucket: String(row.bucket ?? ''), orders: num(row.orders), revenue: num(row.revenue) })).filter((row) => DAY_RE.test(row.bucket)),
    categories: rows(data.categories).map((row) => ({ id: str(row.id), name: str(row.name), revenue: num(row.revenue), units: num(row.units) })),
    products: rows(data.products).map((row) => ({ id: str(row.id), name: str(row.name) ?? 'Article', revenue: num(row.revenue), units: num(row.units) })),
    fulfillment: breakdown(data.fulfillment),
    paymentMethods: breakdown(data.payment_methods),
    countries: breakdown(data.countries),
    heatmap: rows(data.heatmap).map((row) => ({ weekday: num(row.weekday), slot: num(row.slot), orders: num(row.orders) })),
  };
}

// ─── Series ────────────────────────────────────────────────────────────────

/** Start (YYYY-MM-DD) of the bucket holding `day` (weeks start on Monday, like Postgres date_trunc). */
export function bucketStart(day: string, bucket: StatisticsBucket): string {
  if (bucket === 'day') return day;
  if (bucket === 'month') return `${day.slice(0, 7)}-01`;
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

export function nextBucket(start: string, bucket: StatisticsBucket): string {
  if (bucket === 'day') return addDays(start, 1);
  if (bucket === 'week') return addDays(start, 7);
  return addMonths(start, 1);
}

export interface SeriesPoint { bucket: string; orders: number; revenue: number }

/** One point per bucket of the range, zeros included, in order. */
export function fillSeries(series: SeriesRow[], range: StatisticsRange, bucket: StatisticsBucket): SeriesPoint[] {
  const byBucket = new Map(series.map((row) => [row.bucket, row]));
  const points: SeriesPoint[] = [];
  for (let start = bucketStart(range.fromDay, bucket); start <= range.toDay; start = nextBucket(start, bucket)) {
    const row = byBucket.get(start);
    points.push({ bucket: start, orders: row?.orders ?? 0, revenue: row?.revenue ?? 0 });
    if (points.length > 400) break;
  }
  return points;
}

export function metricValue(point: { orders: number; revenue: number }, metric: StatisticsMetric): number | null {
  if (metric === 'orders') return point.orders;
  if (metric === 'revenue') return point.revenue;
  return point.orders > 0 ? point.revenue / point.orders : null;
}

/**
 * Values plotted for a metric. Cumulative: running total (average: running
 * average basket). Daily: the bucket's own value (average: null without orders).
 */
export function plottedValues(points: SeriesPoint[], metric: StatisticsMetric, display: StatisticsDisplay): Array<number | null> {
  if (display === 'daily') return points.map((point) => metricValue(point, metric));
  let orders = 0;
  let revenue = 0;
  return points.map((point) => {
    orders += point.orders;
    revenue += point.revenue;
    return metricValue({ orders, revenue }, metric);
  });
}

// ─── Comparisons ───────────────────────────────────────────────────────────

export type DeltaDirection = 'up' | 'down' | 'flat';
export interface Delta { direction: DeltaDirection; label: string }

/**
 * Variation shown under a KPI. Null when there is nothing honest to say
 * (no previous value, or too little data: raw values are shown instead).
 */
export function compareValues(current: number, previous: number, options: { limited: boolean; kind: 'count' | 'amount' }): Delta | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const direction: DeltaDirection = current > previous ? 'up' : current < previous ? 'down' : 'flat';
  if (previous === 0) return current === 0 ? { direction: 'flat', label: '=' } : null;
  if (options.limited && options.kind === 'count') {
    const diff = current - previous;
    return { direction, label: diff === 0 ? '=' : `${diff > 0 ? '+' : '−'}${new Intl.NumberFormat('fr-FR').format(Math.abs(diff))}` };
  }
  if (options.limited) return null;
  const ratio = current / previous;
  if (ratio >= 10) return { direction, label: `×${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(ratio)}` };
  const percent = Math.round((ratio - 1) * 100);
  if (percent === 0) return { direction: 'flat', label: '=' };
  return { direction, label: `${percent > 0 ? '+' : '−'}${Math.abs(percent)} %` };
}

// ─── Read-models for the charts ────────────────────────────────────────────

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  stripe: 'Carte bancaire',
  external_link: 'Lien de paiement',
  in_store: 'En boutique',
  cash: 'Espèces',
  satispay: 'Satispay',
  manual: 'Saisie manuelle',
};

export const FULFILLMENT_LABELS: Record<string, string> = { delivery: 'Livraison', pickup: 'Retrait' };

export interface ShareItem { key: string; label: string; value: number; share: number }

/** Parts of a whole, largest first, the tail folded into « Autres » beyond `max` items. */
export function shares(items: Array<{ key: string; label: string; value: number }>, max = 3, otherLabel = 'Autres'): ShareItem[] {
  const positive = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return [];
  const head = positive.length > max ? positive.slice(0, max - 1) : positive;
  const tail = positive.length > max ? positive.slice(max - 1) : [];
  const result = head.map((item) => ({ ...item, share: item.value / total }));
  if (tail.length) {
    const value = tail.reduce((sum, item) => sum + item.value, 0);
    result.push({ key: 'other', label: `${otherLabel} (${tail.length})`, value, share: value / total });
  }
  return result;
}

export interface RankedItem { key: string; label: string; value: number; secondary: number; share: number; other?: boolean }

/** Category bars: the `max - 1` best then « Autres (n) ». */
export function rankCategories(categories: CategoryRow[], max = 6): RankedItem[] {
  const positive = categories.filter((row) => row.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const total = positive.reduce((sum, row) => sum + row.revenue, 0);
  if (total === 0) return [];
  const toItem = (row: CategoryRow): RankedItem => ({ key: row.id ?? 'none', label: row.name ?? 'Sans catégorie', value: row.revenue, secondary: row.units, share: row.revenue / total });
  if (positive.length <= max) return positive.map(toItem);
  const tail = positive.slice(max - 1);
  const value = tail.reduce((sum, row) => sum + row.revenue, 0);
  return [
    ...positive.slice(0, max - 1).map(toItem),
    { key: 'other', label: `Autres (${tail.length})`, value, secondary: tail.reduce((sum, row) => sum + row.units, 0), share: value / total, other: true },
  ];
}

export const HEATMAP_DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'] as const;
export const HEATMAP_SLOTS = ['0h', '4h', '8h', '12h', '16h', '20h'] as const;
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export interface HeatmapGrid { cells: number[][]; max: number; peak: string | null }

/** 7 × 6 grid (Monday first, 4-hour slots) and the busiest cell in words. */
export function heatmapGrid(rows: HeatmapRow[]): HeatmapGrid {
  const cells = Array.from({ length: 7 }, () => Array<number>(6).fill(0));
  for (const row of rows) {
    const line = cells[row.weekday - 1];
    if (line && row.slot >= 0 && row.slot <= 5) line[row.slot] = (line[row.slot] ?? 0) + row.orders;
  }
  let max = 0;
  let peak: [number, number] | null = null;
  cells.forEach((line, day) => line.forEach((value, slot) => { if (value > max) { max = value; peak = [day, slot]; } }));
  const at = peak as [number, number] | null;
  return { cells, max, peak: at ? `${DAY_NAMES[at[0]]} ${at[1] * 4}h–${at[1] * 4 + 4}h` : null };
}

/** Intensity step 0 (none) to 4 for a heatmap cell. */
export function heatmapLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4))) as 1 | 2 | 3 | 4;
}

/** Clean axis maximum and ticks (1, 2, 2.5, 5 × 10^n). */
export function niceTicks(maxValue: number, count = 4): number[] {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return [0, 1];
  const raw = maxValue / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let value = 0; value < maxValue + step * 0.999; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

const SHORT_MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const LONG_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const utc = (day: string) => new Date(`${day}T00:00:00Z`);

/** Axis label of a bucket: « 13 oct. », « oct. ». */
export function bucketAxisLabel(bucket: string, kind: StatisticsBucket): string {
  return kind === 'month' ? SHORT_MONTH.format(utc(bucket)) : DAY_MONTH.format(utc(bucket));
}

/** Tooltip title of a bucket: « mar. 6 oct. », « semaine du 5 oct. », « octobre 2026 ». */
export function bucketLongLabel(bucket: string, kind: StatisticsBucket): string {
  if (kind === 'day') return LONG_DAY.format(utc(bucket));
  if (kind === 'week') return `semaine du ${DAY_MONTH.format(utc(bucket))}`;
  return MONTH_YEAR.format(utc(bucket));
}

/** « du 13 oct. au 11 nov. 2026 ». */
export function rangeLabel(range: StatisticsRange): string {
  const fromYear = range.fromDay.slice(0, 4);
  const toYear = range.toDay.slice(0, 4);
  const from = fromYear === toYear ? DAY_MONTH.format(utc(range.fromDay)) : `${DAY_MONTH.format(utc(range.fromDay))} ${fromYear}`;
  return `du ${from} au ${DAY_MONTH.format(utc(range.toDay))} ${toYear}`;
}
