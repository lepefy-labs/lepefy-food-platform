import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  bucketAxisLabel, bucketForDays, cardPaymentsHref, channelHeatmap, channelRevenue, channelSeries, hasInStoreChannel, bucketLongLabel, bucketStart, compareValues, fillSeries, heatmapGrid, heatmapLevel, niceTicks,
  normalizeSalesStatistics, parseStatisticsQuery, plottedValues, rangeLabel, rangeOf, rankCategories, shares, statisticsHref,
} from '../../src/lib/admin/salesStatistics';
import { permissionForAdminPath } from '../../src/lib/auth/adminRoutePermissions';

const MIGRATION = readFileSync(resolve(__dirname, '../../../../supabase/migrations/181_admin_sales_statistics.sql'), 'utf8');
const MIGRATION_182 = readFileSync(resolve(__dirname, '../../../../supabase/migrations/182_admin_sales_statistics_in_store.sql'), 'utf8');
// 11 November 2026, 10:00 in Paris.
const now = new Date('2026-11-11T09:00:00Z');

test.describe('period from the URL', () => {
  test('default: the last 30 shop days, daily buckets, compared', () => {
    const query = parseStatisticsQuery({}, now);
    expect(query).toMatchObject({ period: '30j', bucket: 'day', compare: true, metric: 'revenue', display: 'cumulative', invalidCustom: false });
    expect(query.range).toMatchObject({ fromDay: '2026-10-13', toDay: '2026-11-11', days: 30 });
    // Shop midnight, not UTC midnight (13 October 00:00 CEST = 12 October 22:00Z; 12 November 00:00 CET = 11 November 23:00Z).
    expect(query.range.fromIso).toBe('2026-10-12T22:00:00.000Z');
    expect(query.range.toIso).toBe('2026-11-11T23:00:00.000Z');
    expect(query.previous).toMatchObject({ fromDay: '2026-09-13', toDay: '2026-10-12', days: 30 });
  });

  test('a late-evening UTC instant already belongs to the next shop day', () => {
    expect(parseStatisticsQuery({ periode: '7j' }, new Date('2026-11-10T23:30:00Z')).range.toDay).toBe('2026-11-11');
  });

  test('bucket follows the length; 12 months are whole calendar months', () => {
    expect(parseStatisticsQuery({ periode: '7j' }, now).bucket).toBe('day');
    expect(parseStatisticsQuery({ periode: '90j' }, now)).toMatchObject({ bucket: 'week', range: { fromDay: '2026-08-14', days: 90 } });
    expect(parseStatisticsQuery({ periode: '12m' }, now)).toMatchObject({ bucket: 'month', range: { fromDay: '2025-12-01', toDay: '2026-11-11' } });
    expect([bucketForDays(31), bucketForDays(32), bucketForDays(120), bucketForDays(121)]).toEqual(['day', 'week', 'week', 'month']);
  });

  test('custom dates: validated, clamped to today, otherwise the default period with a notice', () => {
    expect(parseStatisticsQuery({ periode: 'custom', du: '2026-10-01', au: '2026-10-31' }, now)).toMatchObject({ period: 'custom', range: { days: 31 }, bucket: 'day' });
    expect(parseStatisticsQuery({ periode: 'custom', du: '2026-11-01', au: '2026-12-31' }, now).range.toDay).toBe('2026-11-11');
    for (const bad of [{ du: '2026-10-31', au: '2026-10-01' }, { du: '2026-02-30', au: '2026-03-01' }, { du: 'x', au: '2026-03-01' }, { du: '2020-01-01', au: '2026-01-01' }, { du: '2027-01-01', au: '2027-01-02' }]) {
      expect(parseStatisticsQuery({ periode: 'custom', ...bad }, now)).toMatchObject({ period: '30j', invalidCustom: true });
    }
  });

  test('links keep the other choices and leave defaults out of the URL', () => {
    const query = parseStatisticsQuery({ periode: '90j', indicateur: 'commandes' }, now);
    expect(statisticsHref(query, { period: '30j' })).toBe('/admin?indicateur=commandes');
    expect(statisticsHref(query, { metric: 'revenue' })).toBe('/admin?periode=90j');
    expect(statisticsHref(query, { display: 'daily', compare: false })).toBe('/admin?periode=90j&indicateur=commandes&vue=jour&comparer=0');
    expect(statisticsHref(query, { period: 'custom', du: '2026-01-01', au: '2026-01-31' })).toBe('/admin?periode=custom&du=2026-01-01&au=2026-01-31&indicateur=commandes');
  });

  test('the page stays under orders.view, like the dashboard it replaces', () => {
    expect(permissionForAdminPath('/admin', 'shop')).toBe('orders.view');
  });
});

test.describe('series', () => {
  test('weeks start on Monday and months on the 1st, like date_trunc', () => {
    expect(bucketStart('2026-11-11', 'week')).toBe('2026-11-09');
    expect(bucketStart('2026-11-09', 'week')).toBe('2026-11-09');
    expect(bucketStart('2026-11-08', 'week')).toBe('2026-11-02');
    expect(bucketStart('2026-11-11', 'month')).toBe('2026-11-01');
  });

  test('every bucket of the range exists, zero-filled, in order', () => {
    const points = fillSeries([{ bucket: '2026-11-10', orders: 2, revenue: 50 }], rangeOf('2026-11-08', '2026-11-11'), 'day');
    expect(points.map((point) => point.bucket)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
    expect(points.map((point) => point.revenue)).toEqual([0, 0, 50, 0]);
    expect(fillSeries([], rangeOf('2026-08-14', '2026-11-11'), 'week')).toHaveLength(14);
  });

  test('cumulative and daily values for each metric', () => {
    const points = [{ bucket: 'a', orders: 2, revenue: 100 }, { bucket: 'b', orders: 0, revenue: 0 }, { bucket: 'c', orders: 1, revenue: 20 }];
    expect(plottedValues(points, 'revenue', 'cumulative')).toEqual([100, 100, 120]);
    expect(plottedValues(points, 'orders', 'daily')).toEqual([2, 0, 1]);
    expect(plottedValues(points, 'average', 'daily')).toEqual([50, null, 20]);
    expect(plottedValues(points, 'average', 'cumulative')).toEqual([50, 50, 40]);
  });
});

test.describe('comparisons', () => {
  test('percentages, multiples, equality', () => {
    expect(compareValues(120, 100, { limited: false, kind: 'amount' })).toEqual({ direction: 'up', label: '+20 %' });
    expect(compareValues(80, 100, { limited: false, kind: 'amount' })).toEqual({ direction: 'down', label: '−20 %' });
    expect(compareValues(1336, 103.01, { limited: false, kind: 'amount' })).toEqual({ direction: 'up', label: '×13' });
    expect(compareValues(100, 100, { limited: false, kind: 'amount' })?.label).toBe('=');
  });

  test('nothing to compare with a zero previous value; raw differences with little data', () => {
    expect(compareValues(10, 0, { limited: false, kind: 'amount' })).toBeNull();
    expect(compareValues(0, 0, { limited: true, kind: 'count' })?.label).toBe('=');
    expect(compareValues(5, 3, { limited: true, kind: 'count' })).toEqual({ direction: 'up', label: '+2' });
    expect(compareValues(50, 30, { limited: true, kind: 'amount' })).toBeNull();
  });
});

test.describe('read-models', () => {
  test('RPC payload: numbers as strings, missing keys, bad rows', () => {
    const stats = normalizeSalesStatistics({
      totals: { orders: '3', revenue: '90.50', new_customers: 2 },
      series: [{ bucket: '2026-10-06', orders: 3, revenue: '90.5' }, { bucket: 'nope' }],
      categories: [{ id: null, name: null, revenue: 10, units: 1 }],
      products: [{ id: 'p', name: '', revenue: 1, units: 1 }],
      payment_methods: [null, { key: 'stripe', orders: 1, revenue: 1 }],
    });
    expect(stats.totals).toEqual({ orders: 3, revenue: 90.5, customers: 0, newCustomers: 2, returningCustomers: 0, units: 0 });
    expect(stats.series).toEqual([{ bucket: '2026-10-06', orders: 3, revenue: 90.5 }]);
    expect(stats.products[0]!.name).toBe('Article');
    expect(stats.paymentMethods).toEqual([{ key: 'stripe', orders: 1, revenue: 1 }]);
    expect(stats.heatmap).toEqual([]);
    expect(normalizeSalesStatistics(null).totals.orders).toBe(0);
  });

  test('categories: the best ones then « Autres (n) », unknown category named', () => {
    const ranked = rankCategories([
      { id: 'a', name: 'Farines', revenue: 50, units: 5 }, { id: null, name: null, revenue: 30, units: 1 },
      { id: 'c', name: 'C', revenue: 10, units: 1 }, { id: 'd', name: 'D', revenue: 10, units: 2 }, { id: 'e', name: 'E', revenue: 0, units: 0 },
    ], 3);
    expect(ranked.map((item) => item.label)).toEqual(['Farines', 'Sans catégorie', 'Autres (2)']);
    expect(ranked[2]).toMatchObject({ value: 20, secondary: 3, other: true });
    expect(ranked[0]!.share).toBeCloseTo(0.5);
  });

  test('shares fold the tail and ignore empty parts', () => {
    expect(shares([{ key: 'a', label: 'A', value: 3 }, { key: 'b', label: 'B', value: 1 }, { key: 'c', label: 'C', value: 0 }])).toEqual([
      { key: 'a', label: 'A', value: 3, share: 0.75 }, { key: 'b', label: 'B', value: 1, share: 0.25 },
    ]);
    expect(shares([1, 2, 3, 4].map((value) => ({ key: String(value), label: String(value), value })), 3).map((item) => item.label)).toEqual(['4', '3', 'Autres (2)']);
    expect(shares([{ key: 'a', label: 'A', value: 0 }])).toEqual([]);
  });

  test('heatmap grid, peak in words, intensity steps', () => {
    const grid = heatmapGrid([{ weekday: 1, slot: 3, orders: 4 }, { weekday: 5, slot: 3, orders: 3 }, { weekday: 9, slot: 0, orders: 9 }]);
    expect(grid.cells[0]![3]).toBe(4);
    expect(grid.max).toBe(4);
    expect(grid.peak).toBe('lundi 12h–16h');
    expect([heatmapLevel(0, 4), heatmapLevel(1, 4), heatmapLevel(3, 4), heatmapLevel(4, 4)]).toEqual([0, 1, 3, 4]);
    expect(heatmapGrid([]).peak).toBeNull();
  });

  test('axis ticks are round numbers covering the maximum', () => {
    expect(niceTicks(1336)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  test('French labels', () => {
    expect(bucketAxisLabel('2026-10-13', 'day')).toBe('13 oct.');
    expect(bucketLongLabel('2026-11-01', 'day')).toBe('dim. 1 nov.');
    expect(bucketLongLabel('2026-11-09', 'week')).toBe('semaine du 9 nov.');
    expect(bucketLongLabel('2026-10-01', 'month')).toBe('octobre 2026');
    expect(rangeLabel(rangeOf('2026-10-13', '2026-11-11'))).toBe('du 13 oct. au 11 nov. 2026');
    expect(rangeLabel(rangeOf('2025-12-01', '2026-11-11'))).toBe('du 1 déc. 2025 au 11 nov. 2026');
  });
});

test('SQL counts the same orders as the documented rule and stays service-role only', () => {
  expect(MIGRATION).toContain("o.is_test = false");
  expect(MIGRATION).toContain("o.payment_status = 'paid'");
  expect(MIGRATION).toContain("o.status <> 'cancelled'");
  expect(MIGRATION).toMatch(/revoke all on function public\.admin_sales_statistics\([^)]*\) from public, anon, authenticated;/);
  expect(MIGRATION).toMatch(/grant execute on function public\.admin_sales_statistics\([^)]*\) to service_role;/);
});

test.describe('in-store channel (/card payments)', () => {
  const stats = normalizeSalesStatistics({
    totals: { orders: 2, revenue: 100 },
    series: [{ bucket: '2026-11-09', orders: 2, revenue: 100 }],
    heatmap: [{ weekday: 1, slot: 3, orders: 2 }],
    in_store: {
      payments: '3', revenue: '45.5',
      series: [{ bucket: '2026-11-09', payments: 1, revenue: 20 }, { bucket: '2026-11-10', payments: 2, revenue: '25.5' }],
      heatmap: [{ weekday: 1, slot: 3, payments: 1 }, { weekday: 2, slot: 2, payments: 2 }],
    },
  });
  const range = rangeOf('2026-11-09', '2026-11-11');

  test('channel parameters round-trip and default to both channels', () => {
    const query = parseStatisticsQuery({ canal: 'boutique', moments: 'en-ligne' }, now);
    expect(query).toMatchObject({ channel: 'in_store', heatChannel: 'online' });
    expect(parseStatisticsQuery({ canal: 'nimporte' }, now).channel).toBe('all');
    expect(statisticsHref(query, {})).toBe('/admin?canal=boutique&moments=en-ligne');
    expect(statisticsHref(query, { channel: 'all', heatChannel: 'all' })).toBe('/admin');
  });

  test('payload before migration 182: zeros, no channel to show', () => {
    const before = normalizeSalesStatistics({ totals: { orders: 1, revenue: 10 } });
    expect(before.inStore).toEqual({ payments: 0, revenue: 0, series: [], heatmap: [] });
    expect(hasInStoreChannel(before, null)).toBe(false);
    expect(hasInStoreChannel(before, stats)).toBe(true);
  });

  test('revenue adds up, orders and payments never do', () => {
    expect(channelRevenue(stats, 'all')).toBe(145.5);
    expect(channelRevenue(stats, 'online')).toBe(100);
    expect(channelRevenue(stats, 'in_store')).toBe(45.5);
    expect(channelSeries(stats, range, 'day', 'all')).toEqual([
      { bucket: '2026-11-09', orders: 2, payments: 1, revenue: 120 },
      { bucket: '2026-11-10', orders: 0, payments: 2, revenue: 25.5 },
      { bucket: '2026-11-11', orders: 0, payments: 0, revenue: 0 },
    ]);
    expect(channelSeries(stats, range, 'day', 'in_store')[0]).toEqual({ bucket: '2026-11-09', orders: 0, payments: 1, revenue: 20 });
    expect(channelSeries(stats, range, 'day', 'online')[1]).toEqual({ bucket: '2026-11-10', orders: 0, payments: 0, revenue: 0 });
  });

  test('heatmap per channel', () => {
    expect(heatmapGrid(channelHeatmap(stats, 'all')).cells[0]![3]).toBe(3);
    expect(heatmapGrid(channelHeatmap(stats, 'in_store')).peak).toBe('mardi 8h–12h');
    expect(heatmapGrid(channelHeatmap(stats, 'online')).cells[1]![2]).toBe(0);
  });

  test('link to the payments register for the same days, paid only', () => {
    expect(cardPaymentsHref(range)).toBe('/admin/paiements-carte?period=custom&from=2026-11-09&to=2026-11-11&status=paid');
  });

  test('SQL: paid /card payments of the tenant only, orders rule and privileges kept', () => {
    expect(MIGRATION_182).toContain("cp.status = 'paid'");
    expect(MIGRATION_182).toContain('cp.tenant_id = p_tenant_id');
    expect(MIGRATION_182).toContain("o.is_test = false");
    expect(MIGRATION_182).toMatch(/revoke all on function public\.admin_sales_statistics\([^)]*\) from public, anon, authenticated;/);
    expect(MIGRATION_182).toMatch(/grant execute on function public\.admin_sales_statistics\([^)]*\) to service_role;/);
  });
});
