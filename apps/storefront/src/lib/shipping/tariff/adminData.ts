/**
 * Données serveur de l'onglet Admin → Livraison → Forfait shadow.
 * Toutes les lectures sont tenant-scopées (service role).
 */

import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingPricingMode, ShippingTariffDraftRow, ShippingTariffVersionRow } from '@lepefy/types';

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface MissingWeightProduct { id: string; name: string; stock: number | null; weight_grams: number | null }

export interface ForfaitShadowAdminData {
  /** false tant que la migration 124 n'est pas appliquée : aucune action possible. */
  migrationReady: boolean;
  pricingMode: ShippingPricingMode | null;
  versions: ShippingTariffVersionRow[];
  drafts: Pick<ShippingTariffDraftRow, 'id' | 'name' | 'bands' | 'zone_surcharges' | 'multi_parcel_strategy' | 'created_at'>[];
  missingWeightProducts: MissingWeightProduct[];
  activeProducts: number;
  zoneCodes: string[];
  vatRates: Array<{ countries: string[]; vat_rate: number }>;
}

export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205';
}

export async function loadPricingMode(supabase: ServiceClient, tenantId: string): Promise<ShippingPricingMode | null> {
  const { data, error } = await supabase.from('tenants').select('shipping_pricing_mode').eq('id', tenantId).maybeSingle();
  if (error || !data) return null;
  return (data as { shipping_pricing_mode: ShippingPricingMode }).shipping_pricing_mode ?? null;
}

export async function loadForfaitShadowAdminData(supabase: ServiceClient, tenantId: string): Promise<ForfaitShadowAdminData> {
  const [versionsResult, pricingMode, draftsResult, missingResult, activeCount, zonesResult, vatResult] = await Promise.all([
    supabase.from('shipping_tariff_versions').select('*').eq('tenant_id', tenantId)
      .order('country', { ascending: true }).order('version', { ascending: false }),
    loadPricingMode(supabase, tenantId),
    supabase.from('shipping_tariff_drafts').select('id, name, bands, zone_surcharges, multi_parcel_strategy, created_at')
      .eq('tenant_id', tenantId).eq('status', 'draft').order('created_at', { ascending: false }),
    supabase.from('products').select('id, name, stock, weight_grams').eq('tenant_id', tenantId).eq('active', true)
      .or('weight_grams.is.null,weight_grams.lte.0').order('name', { ascending: true }).limit(1000),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('active', true),
    supabase.from('shipping_zones').select('code').eq('tenant_id', tenantId).eq('active', true).order('position', { ascending: true }),
    supabase.from('shipping_vat_rates').select('countries, vat_rate').eq('tenant_id', tenantId).eq('active', true),
  ]);

  const migrationReady = !versionsResult.error && pricingMode !== null;
  if (versionsResult.error && !isMissingSchemaError(versionsResult.error)) {
    console.error('[forfait-shadow] versions lookup failed — tenant:', tenantId, versionsResult.error);
  }

  return {
    migrationReady,
    pricingMode,
    versions: (versionsResult.error ? [] : versionsResult.data ?? []) as ShippingTariffVersionRow[],
    drafts: (draftsResult.data ?? []) as ForfaitShadowAdminData['drafts'],
    missingWeightProducts: (missingResult.data ?? []) as MissingWeightProduct[],
    activeProducts: activeCount.count ?? 0,
    zoneCodes: [...new Set(((zonesResult.data ?? []) as Array<{ code: string }>).map((z) => z.code))],
    vatRates: (vatResult.data ?? []) as ForfaitShadowAdminData['vatRates'],
  };
}
