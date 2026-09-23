/**
 * Données serveur de l'onglet Admin → Livraison → Forfait (shadow + tarification
 * commerciale). Toutes les lectures sont tenant-scopées (service role).
 */

import type { createServiceClient } from '@/lib/supabase/server';
import type {
  ShippingPackagingProfileRow, ShippingPricingMode, ShippingTariffDraftRow, ShippingTariffFallback, ShippingTariffVersionRow,
} from '@lepefy/types';
import type { ShippingCountryRule } from '@/lib/shipping/resolveCountryRule';

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface MissingWeightProduct { id: string; name: string; stock: number | null; weight_grams: number | null }

export interface ForfaitShadowAdminData {
  /** false tant que la migration 124 n'est pas appliquée : aucune action possible. */
  migrationReady: boolean;
  /** Migration 125 (activation commerciale, repli, tare). */
  activationReady: boolean;
  pricingMode: ShippingPricingMode | null;
  fallback: ShippingTariffFallback;
  /** Page publique /livraison visible (migration 125, défaut false). */
  publicGridEnabled: boolean;
  versions: ShippingTariffVersionRow[];
  drafts: Pick<ShippingTariffDraftRow, 'id' | 'name' | 'bands' | 'zone_surcharges' | 'multi_parcel_strategy' | 'created_at'>[];
  missingWeightProducts: MissingWeightProduct[];
  activeProducts: number;
  zoneCodes: string[];
  vatRates: Array<{ countries: string[]; vat_rate: number }>;
  countryRules: ShippingCountryRule[];
  profiles: ShippingPackagingProfileRow[];
  /** id admin → e-mail, pour « activée par ». */
  adminEmails: Record<string, string>;
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

/** Repli configuré ; null si la migration 125 n'est pas appliquée. */
export async function loadTariffFallback(supabase: ServiceClient, tenantId: string): Promise<ShippingTariffFallback | null> {
  const { data, error } = await supabase.from('tenants').select('shipping_tariff_fallback').eq('id', tenantId).maybeSingle();
  if (error || !data) return null;
  return (data as { shipping_tariff_fallback: ShippingTariffFallback }).shipping_tariff_fallback ?? null;
}

/** Page publique /livraison ; false si la migration 125 n'est pas appliquée. */
export async function loadPublicGridEnabled(supabase: ServiceClient, tenantId: string): Promise<boolean> {
  const { data, error } = await supabase.from('tenants').select('shipping_public_grid_enabled').eq('id', tenantId).maybeSingle();
  if (error || !data) return false;
  return (data as { shipping_public_grid_enabled: boolean }).shipping_public_grid_enabled === true;
}

export async function loadForfaitShadowAdminData(supabase: ServiceClient, tenantId: string): Promise<ForfaitShadowAdminData> {
  const [versionsResult, pricingMode, fallback, publicGridEnabled, draftsResult, missingResult, activeCount, zonesResult, vatResult, rulesResult, profilesResult] = await Promise.all([
    supabase.from('shipping_tariff_versions').select('*').eq('tenant_id', tenantId)
      .order('country', { ascending: true }).order('version', { ascending: false }),
    loadPricingMode(supabase, tenantId),
    loadTariffFallback(supabase, tenantId),
    loadPublicGridEnabled(supabase, tenantId),
    supabase.from('shipping_tariff_drafts').select('id, name, bands, zone_surcharges, multi_parcel_strategy, created_at')
      .eq('tenant_id', tenantId).eq('status', 'draft').order('created_at', { ascending: false }),
    supabase.from('products').select('id, name, stock, weight_grams').eq('tenant_id', tenantId).eq('active', true)
      .or('weight_grams.is.null,weight_grams.lte.0').order('name', { ascending: true }).limit(1000),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('active', true),
    supabase.from('shipping_zones').select('code').eq('tenant_id', tenantId).eq('active', true).order('position', { ascending: true }),
    supabase.from('shipping_vat_rates').select('countries, vat_rate').eq('tenant_id', tenantId).eq('active', true),
    supabase.from('shipping_country_rules')
      .select('countries, free_shipping_above, flat_rate_override, discount_type, discount_value')
      .eq('tenant_id', tenantId).eq('active', true),
    supabase.from('shipping_packaging_profiles').select('*').eq('tenant_id', tenantId).eq('active', true)
      .order('position', { ascending: true }),
  ]);

  const migrationReady = !versionsResult.error && pricingMode !== null;
  if (versionsResult.error && !isMissingSchemaError(versionsResult.error)) {
    console.error('[forfait-shadow] versions lookup failed — tenant:', tenantId, versionsResult.error);
  }
  const versions = (versionsResult.error ? [] : versionsResult.data ?? []) as ShippingTariffVersionRow[];

  const adminIds = [...new Set(versions.flatMap((v) => [v.created_by, v.activated_by, v.retired_by]).filter((id): id is string => Boolean(id)))];
  const adminEmails: Record<string, string> = {};
  if (adminIds.length > 0) {
    const { data: admins } = await supabase.from('admin_users').select('id, email').in('id', adminIds);
    for (const a of (admins ?? []) as Array<{ id: string; email: string }>) adminEmails[a.id] = a.email;
  }

  return {
    migrationReady,
    activationReady: migrationReady && fallback !== null,
    pricingMode,
    fallback: fallback ?? 'unavailable',
    publicGridEnabled,
    versions,
    drafts: (draftsResult.data ?? []) as ForfaitShadowAdminData['drafts'],
    missingWeightProducts: (missingResult.data ?? []) as MissingWeightProduct[],
    activeProducts: activeCount.count ?? 0,
    zoneCodes: [...new Set(((zonesResult.data ?? []) as Array<{ code: string }>).map((z) => z.code))],
    vatRates: (vatResult.data ?? []) as ForfaitShadowAdminData['vatRates'],
    countryRules: (rulesResult.data ?? []) as ShippingCountryRule[],
    profiles: (profilesResult.data ?? []) as ShippingPackagingProfileRow[],
    adminEmails,
  };
}
