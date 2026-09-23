/**
 * POST /api/admin/shipping-tariff-drafts/:id/simulate
 *
 * Rétrotest d'un brouillon tarifaire — jamais lu par le checkout. Deux
 * populations distinctes, jamais pondérées ensemble :
 *  - scenarioWeighted : scénarios SYNTHÉTIQUES des campagnes/tests — une seule
 *                       observation opérationnelle (service éligible au coût
 *                       base + taxes le plus bas) par scénario mesuré, la plus
 *                       récente ; les offres alternatives d'un même devis et
 *                       les réemplois ne sont jamais comptés comme échantillons ;
 *  - orderWeighted    : devis Packlink enregistrés au moment des commandes
 *                       réelles (orders.shipping_details) — pas un coût final
 *                       facturé.
 * Les expéditions au coût final vérifié (source real_shipment) sont seulement
 * dénombrées : aucune n'est alimentée à ce jour.
 *
 * Base TTC : les brouillons sont des prix client TTC ; les devis Packlink sont
 * HT (tax_price = 0) et reçoivent la TVA du pays (shipping_vat_rates), comme
 * au checkout. Les frais d'emballage par colis ne sont pas inclus.
 * Pays : body { country } (défaut IT) — scénarios et commandes filtrés.
 */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  assessScenarioReliability,
  backtestTariff,
  buildScenarioBacktestSample,
  orderBacktestRows,
  type BacktestRow,
  type ScenarioBacktestObservation,
} from '@/lib/shipping/intelligence/tariffBacktest';
import { fetchAllPages } from '@/lib/shipping/intelligence/pagedQuery';
import { resolveZoneCodeFromRows } from '@/lib/shipping/intelligence/resolveZone';
import { resolveVatRate, type VatRate } from '@/lib/shipping/calculateShipping';
import type { ShippingTariffDraftRow, ShippingZoneRow } from '@lepefy/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MIN_SAMPLE_FOR_CONFIDENT_BACKTEST = 30;
const MAX_OFFER_ROWS = 30_000;
const MAX_ORDER_ROWS = 10_000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as { country?: unknown };
  const country = typeof body.country === 'string' && /^[A-Za-z]{2}$/.test(body.country) ? body.country.toUpperCase() : 'IT';

  const supabase = createServiceClient();

  const { data: draft, error: draftError } = await supabase
    .from('shipping_tariff_drafts')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .single();

  if (draftError || !draft) return NextResponse.json({ error: 'Brouillon introuvable.' }, { status: 404 });
  const tariffDraft = draft as ShippingTariffDraftRow;

  const [offers, orders, verifiedShipments, { data: zoneRows }, { data: vatRows }] = await Promise.all([
    fetchAllPages<ScenarioBacktestObservation>((from, to) => supabase
      .from('shipping_quote_observations')
      .select('id, request_hash, observed_at, eligible, total_provider_cost, tax_price, total_weight_g, destination_zone_code, destination_country, destination_postal_code, num_parcels')
      .eq('tenant_id', tenant.id)
      .eq('destination_country', country)
      .eq('source', 'synthetic_simulation')
      .eq('eligible', true)
      .not('total_provider_cost', 'is', null)
      .order('observed_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PageResult<ScenarioBacktestObservation>,
    { maxRows: MAX_OFFER_ROWS }),
    fetchAllPages<{ shipping_details: Record<string, unknown> | null; shipping_address: Record<string, unknown> | null }>((from, to) => supabase
      .from('orders')
      .select('shipping_details, shipping_address')
      .eq('tenant_id', tenant.id)
      .eq('fulfillment_type', 'delivery')
      .not('shipping_details', 'is', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PageResult<{ shipping_details: Record<string, unknown> | null; shipping_address: Record<string, unknown> | null }>,
    { maxRows: MAX_ORDER_ROWS }),
    supabase
      .from('shipping_quote_observations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('source', 'real_shipment'),
    supabase.from('shipping_zones').select('*').eq('tenant_id', tenant.id).eq('active', true),
    supabase.from('shipping_vat_rates').select('countries, vat_rate').eq('tenant_id', tenant.id).eq('active', true),
  ]);

  if (offers.error || orders.error) {
    return NextResponse.json({ error: 'Impossible de charger les données du rétrotest.' }, { status: 500 });
  }

  // Zone recalculée depuis le CAP : les observations anciennes n'ont pas
  // toujours destination_zone_code, et les surcharges de zone en dépendent.
  const zones = (zoneRows ?? []) as ShippingZoneRow[];
  const scenarioSample = buildScenarioBacktestSample(
    offers.rows,
    (destinationCountry, postalCode) => resolveZoneCodeFromRows(zones, destinationCountry, postalCode),
    (destinationCountry) => resolveVatRate(destinationCountry, (vatRows ?? []) as VatRate[]),
  );

  const orderRows: BacktestRow[] = orderBacktestRows(orders.rows, country);

  const scenarioWeighted = backtestTariff(
    tariffDraft.bands, tariffDraft.zone_surcharges, tariffDraft.multi_parcel_strategy, scenarioSample.rows,
  );
  const orderWeighted = backtestTariff(
    tariffDraft.bands, tariffDraft.zone_surcharges, tariffDraft.multi_parcel_strategy, orderRows,
  );

  return NextResponse.json({
    country,
    costBasis: 'ttc',
    scenarioWeighted,
    scenarioSample: {
      ...scenarioSample.stats,
      reliability: assessScenarioReliability(scenarioSample.stats),
      truncated: offers.truncated,
    },
    orderWeighted,
    orderWeightedReliable: orderWeighted.sampleSize >= MIN_SAMPLE_FOR_CONFIDENT_BACKTEST,
    orderSample: { ordersRead: orders.rows.length, usable: orderRows.length, truncated: orders.truncated },
    verifiedShipmentCosts: verifiedShipments.count ?? 0,
    minSampleForConfidentBacktest: MIN_SAMPLE_FOR_CONFIDENT_BACKTEST,
  });
}
