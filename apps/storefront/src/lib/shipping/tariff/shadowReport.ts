/**
 * Rapport shadow : agrégats sur les commandes RÉELLES du tenant portant un
 * `shipping_details.shadow_tariff`. Ne mélange jamais les scénarios
 * synthétiques du laboratoire. Seules les simulations `complete` alimentent
 * les statistiques de prix ; incomplètes, indisponibles et erreurs sont
 * comptées et listées à part.
 *
 * `summarizeShadowOrders` est pure (testée) ; `loadShadowReport` lit les
 * commandes tenant-scopées par pages explicites.
 */

import type { createServiceClient } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/shipping/intelligence/pagedQuery';
import type { ShadowTariffReason, ShadowTariffRecord, ShadowTariffStatus } from './shadowTariff';

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface ShadowReportOrder {
  id: string;
  created_at: string;
  fulfillment_type: 'delivery' | 'pickup' | string;
  is_test?: boolean | null;
  shipping_details: Record<string, unknown> | null;
}

export type ShadowReportReliability = 'insufficient' | 'limited' | 'indicative';
export const MIN_ORDERS_FOR_LIMITED = 30;
export const MIN_ORDERS_FOR_INDICATIVE = 100;

export interface ShadowReportGroup { key: string; label: string; count: number; avgShadowCents: number; avgChargedCents: number }

export interface ShadowReportOrderLine {
  id: string;
  createdAt: string;
  status: ShadowTariffStatus;
  reasons: ShadowTariffReason[];
  version: number | null;
  zoneCode: string | null;
  weightG: number | null;
  chargedCents: number;
  shadowCents: number | null;
  marginBeforePackagingCents: number | null;
  missingWeightProducts: number;
}

export interface ShadowReport {
  deliveryOrders: number;
  pickupOrders: number;
  withoutShadow: number;
  recorded: number;
  byStatus: Record<ShadowTariffStatus, number>;
  reasons: Array<{ reason: ShadowTariffReason; count: number }>;
  versions: Array<{ versionId: string; version: number; country: string; count: number }>;
  gap: { count: number; avgCents: number | null; medianCents: number | null; minCents: number | null; maxCents: number | null; buckets: Array<{ label: string; count: number }> };
  providerQuote: { verified: number; avgTtcCents: number | null };
  marginBeforePackaging: { count: number; avgCents: number | null; negative: number };
  byBand: ShadowReportGroup[];
  byZone: ShadowReportGroup[];
  logisticsWarnings: number;
  negativeMarginOrders: ShadowReportOrderLine[];
  excludedOrders: ShadowReportOrderLine[];
  reliability: ShadowReportReliability;
  latestVersion: { version: number; computedAt: string } | null;
}

const GAP_BUCKETS: Array<{ label: string; test: (c: number) => boolean }> = [
  { label: '< −3 €', test: (c) => c < -300 },
  { label: '−3 à −1 €', test: (c) => c >= -300 && c < -100 },
  { label: '−1 à +1 €', test: (c) => c >= -100 && c <= 100 },
  { label: '+1 à +3 €', test: (c) => c > 100 && c <= 300 },
  { label: '> +3 €', test: (c) => c > 300 },
];

function avg(values: number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const kg = (g: number) => (g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

export function bandLabel(record: ShadowTariffRecord): string {
  const p = record.pricing;
  if (!p) return '—';
  const band = p.band ? `${kg(p.band.minGExclusive)}–${p.band.maxGInclusive === null ? '∞' : kg(p.band.maxGInclusive)} kg` : null;
  if (p.blocks > 0) return `${p.blocks} bloc(s)${band ? ` + ${band}` : ''}`;
  return band ?? '—';
}

function isShadowRecord(value: unknown): value is ShadowTariffRecord {
  return Boolean(value) && typeof value === 'object' && (value as { schema?: unknown }).schema === 1
    && typeof (value as { status?: unknown }).status === 'string';
}

function line(order: ShadowReportOrder, r: ShadowTariffRecord): ShadowReportOrderLine {
  return {
    id: order.id,
    createdAt: order.created_at,
    status: r.status,
    reasons: r.reasons,
    version: r.tariff?.version ?? null,
    zoneCode: r.destination.zoneCode,
    weightG: r.weight.netG,
    chargedCents: r.chargedCents,
    shadowCents: r.shadowTtcCents,
    marginBeforePackagingCents: r.comparison.expectedMarginBeforePackagingCents,
    missingWeightProducts: r.weight.missingWeightProductIds.length,
  };
}

function group(entries: Array<{ key: string; label: string; shadow: number; charged: number }>): ShadowReportGroup[] {
  const map = new Map<string, { label: string; shadow: number[]; charged: number[] }>();
  for (const e of entries) {
    const g = map.get(e.key) ?? { label: e.label, shadow: [], charged: [] };
    g.shadow.push(e.shadow);
    g.charged.push(e.charged);
    map.set(e.key, g);
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, label: g.label, count: g.shadow.length, avgShadowCents: avg(g.shadow)!, avgChargedCents: avg(g.charged)! }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function summarizeShadowOrders(orders: ShadowReportOrder[], filter: { versionId?: string | null } = {}): ShadowReport {
  const byStatus: Record<ShadowTariffStatus, number> = { complete: 0, incomplete: 0, unavailable: 0, error: 0 };
  const reasonCounts = new Map<ShadowTariffReason, number>();
  const versions = new Map<string, { versionId: string; version: number; country: string; count: number }>();
  const gaps: number[] = [];
  const providerQuotes: number[] = [];
  const margins: number[] = [];
  const bands: Array<{ key: string; label: string; shadow: number; charged: number }> = [];
  const zones: Array<{ key: string; label: string; shadow: number; charged: number }> = [];
  const negative: ShadowReportOrderLine[] = [];
  const excluded: ShadowReportOrderLine[] = [];
  let deliveryOrders = 0;
  let pickupOrders = 0;
  let withoutShadow = 0;
  let recorded = 0;
  let logisticsWarnings = 0;
  let latest: { version: number; computedAt: string } | null = null;

  for (const order of orders) {
    if (order.is_test) continue;
    if (order.fulfillment_type !== 'delivery') { pickupOrders += 1; continue; }
    deliveryOrders += 1;
    const record = order.shipping_details?.shadow_tariff;
    if (!isShadowRecord(record)) { withoutShadow += 1; continue; }
    if (filter.versionId && record.tariff?.versionId !== filter.versionId) continue;

    recorded += 1;
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    for (const reason of record.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    if (record.tariff) {
      const v = versions.get(record.tariff.versionId) ?? { versionId: record.tariff.versionId, version: record.tariff.version, country: record.tariff.country, count: 0 };
      v.count += 1;
      versions.set(record.tariff.versionId, v);
      if (!latest || record.computedAt > latest.computedAt) latest = { version: record.tariff.version, computedAt: record.computedAt };
    }

    if (record.status !== 'complete' || record.shadowTtcCents === null) {
      excluded.push(line(order, record));
      continue;
    }

    const gap = record.comparison.shadowMinusChargedCents ?? record.shadowTtcCents - record.chargedCents;
    gaps.push(gap);
    if (record.provider.quoteTtcCents !== null) providerQuotes.push(record.provider.quoteTtcCents);
    const margin = record.comparison.expectedMarginBeforePackagingCents;
    if (margin !== null) {
      margins.push(margin);
      if (margin < 0) negative.push(line(order, record));
    }
    if (record.warnings.includes('logistics_unverified_weight')) logisticsWarnings += 1;
    const label = bandLabel(record);
    bands.push({ key: label, label, shadow: record.shadowTtcCents, charged: record.chargedCents });
    const zone = record.destination.zoneCode ?? '—';
    zones.push({ key: zone, label: zone, shadow: record.shadowTtcCents, charged: record.chargedCents });
  }

  const complete = byStatus.complete;
  return {
    deliveryOrders,
    pickupOrders,
    withoutShadow,
    recorded,
    byStatus,
    reasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    versions: [...versions.values()].sort((a, b) => b.version - a.version),
    gap: {
      count: gaps.length,
      avgCents: avg(gaps),
      medianCents: median(gaps),
      minCents: gaps.length ? Math.min(...gaps) : null,
      maxCents: gaps.length ? Math.max(...gaps) : null,
      buckets: GAP_BUCKETS.map((b) => ({ label: b.label, count: gaps.filter(b.test).length })),
    },
    providerQuote: { verified: providerQuotes.length, avgTtcCents: avg(providerQuotes) },
    marginBeforePackaging: { count: margins.length, avgCents: avg(margins), negative: margins.filter((m) => m < 0).length },
    byBand: group(bands),
    byZone: group(zones),
    logisticsWarnings,
    negativeMarginOrders: negative.sort((a, b) => (a.marginBeforePackagingCents ?? 0) - (b.marginBeforePackagingCents ?? 0)).slice(0, 50),
    excludedOrders: excluded.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
    reliability: complete < MIN_ORDERS_FOR_LIMITED ? 'insufficient' : complete < MIN_ORDERS_FOR_INDICATIVE ? 'limited' : 'indicative',
    latestVersion: latest,
  };
}

export const MAX_REPORT_ORDERS = 10_000;

export async function loadShadowReport(
  supabase: ServiceClient,
  tenantId: string,
  opts: { fromIso: string; toIso: string; versionId?: string | null },
): Promise<{ report: ShadowReport; truncated: boolean } | { error: string }> {
  type PageResult = { data: ShadowReportOrder[] | null; error: { message: string } | null };
  const result = await fetchAllPages<ShadowReportOrder>((from, to) => supabase
    .from('orders')
    .select('id, created_at, fulfillment_type, is_test, shipping_details')
    .eq('tenant_id', tenantId)
    .gte('created_at', opts.fromIso)
    .lte('created_at', opts.toIso)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to) as unknown as PromiseLike<PageResult>,
  { maxRows: MAX_REPORT_ORDERS });
  if (result.error) return { error: result.error };
  return { report: summarizeShadowOrders(result.rows, { versionId: opts.versionId }), truncated: result.truncated };
}

/** Période du rapport (jours UTC inclus) ; 30 derniers jours par défaut. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function reportPeriod(from: string | null, to: string | null, now = new Date()): { fromIso: string; toIso: string } | null {
  const toDay = to && DAY.test(to) ? to : now.toISOString().slice(0, 10);
  const fromDay = from && DAY.test(from) ? from : new Date(Date.parse(`${toDay}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const fromIso = `${fromDay}T00:00:00.000Z`;
  const toIso = `${toDay}T23:59:59.999Z`;
  if (Number.isNaN(Date.parse(fromIso)) || Number.isNaN(Date.parse(toIso)) || fromIso > toIso) return null;
  return { fromIso, toIso };
}
