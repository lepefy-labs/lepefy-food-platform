/**
 * POST /api/admin/shipping-tariff-drafts/:id/simulate
 *
 * Rétrotest d'un brouillon tarifaire — jamais lu par le checkout. Deux
 * métriques distinctes, jamais pondérées ensemble (voir règles d'analyse
 * statistique de la proposition) :
 *  - scenarioWeighted : observations de simulation (grille synthétique)
 *  - orderWeighted    : commandes réelles (orders.shipping_details), quand
 *                       suffisamment de données existent
 */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { backtestTariff, type BacktestRow } from '@/lib/shipping/intelligence/tariffBacktest';
import type { ShippingQuoteObservationRow, ShippingTariffDraftRow } from '@lepefy/types';

export const runtime = 'nodejs';

const MIN_SAMPLE_FOR_CONFIDENT_BACKTEST = 30;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data: draft, error: draftError } = await supabase
    .from('shipping_tariff_drafts')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .single();

  if (draftError || !draft) return NextResponse.json({ error: 'Brouillon introuvable.' }, { status: 404 });
  const tariffDraft = draft as ShippingTariffDraftRow;

  const { data: observations } = await supabase
    .from('shipping_quote_observations')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('eligible', true)
    .not('total_provider_cost', 'is', null)
    .limit(2000);

  const scenarioRows: BacktestRow[] = ((observations as ShippingQuoteObservationRow[] | null) ?? []).map((o) => ({
    providerCost: o.total_provider_cost as number,
    weightKg: o.total_weight_g / 1000,
    zoneCode: o.destination_zone_code,
    numParcels: o.num_parcels,
  }));

  const { data: orders } = await supabase
    .from('orders')
    .select('shipping_details')
    .eq('tenant_id', tenant.id)
    .eq('fulfillment_type', 'delivery')
    .not('shipping_details', 'is', null)
    .limit(1000);

  const orderRows: BacktestRow[] = ((orders as { shipping_details: Record<string, unknown> | null }[] | null) ?? [])
    .map((o) => o.shipping_details)
    .filter((d): d is Record<string, unknown> => d !== null && typeof d.packlinkCost === 'number' && typeof d.totalWeightG === 'number')
    .map((d) => ({
      providerCost: d.packlinkCost as number,
      weightKg: (d.totalWeightG as number) / 1000,
      zoneCode: null,
      numParcels: typeof d.numParcels === 'number' ? d.numParcels : 1,
    }));

  const scenarioWeighted = backtestTariff(
    tariffDraft.bands, tariffDraft.zone_surcharges, tariffDraft.multi_parcel_strategy, scenarioRows,
  );
  const orderWeighted = backtestTariff(
    tariffDraft.bands, tariffDraft.zone_surcharges, tariffDraft.multi_parcel_strategy, orderRows,
  );

  return NextResponse.json({
    scenarioWeighted,
    orderWeighted,
    orderWeightedReliable: orderWeighted.sampleSize >= MIN_SAMPLE_FOR_CONFIDENT_BACKTEST,
    minSampleForConfidentBacktest: MIN_SAMPLE_FOR_CONFIDENT_BACKTEST,
  });
}
