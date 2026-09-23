/**
 * Griglia pubblica delle spese di consegna, generata ESCLUSIVAMENTE dalla
 * versione tariffaria attiva (nessun importo scritto a mano). Distingue prezzo
 * base, maggiorazioni geografiche, condizioni di gratuità e destinazioni non
 * servite.
 */

import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingTariffVersionRow } from '@lepefy/types';
import { resolveCountryRule, type ShippingCountryRule } from '@/lib/shipping/resolveCountryRule';
import { extraCustomsTerritoriesFor } from '@/lib/shipping/extraCustomsTerritories';
import { parseTariffVersion } from './tariffVersion';

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface PublicTariffCountry {
  country: string;
  version: number;
  pricesIncludeVat: boolean;
  bands: Array<{ minG: number; maxG: number | null; priceCents: number }>;
  block: { weightG: number; priceCents: number } | null;
  maxParcelWeightG: number;
  surcharges: Array<{ zoneCode: string; amountCents: number; perParcel: boolean }>;
  nonDeliverableZones: string[];
  extraCustomsTerritories: Array<{ postalCode: string; name: string }>;
  /** flat_rate_override: remplace la grille pour ce pays. */
  flatRateOverrideCents: number | null;
  discount: { type: 'percentage' | 'fixed'; value: number } | null;
  freeShippingAboveCents: number | null;
}

export function buildPublicGrid(versions: ShippingTariffVersionRow[], rules: ShippingCountryRule[]): PublicTariffCountry[] {
  return versions
    .filter((v) => v.status === 'active' && parseTariffVersion(v).ok)
    .sort((a, b) => a.country.localeCompare(b.country))
    .map((v) => {
      const rule = resolveCountryRule(v.country, rules);
      return {
        country: v.country,
        version: v.version,
        pricesIncludeVat: v.prices_include_vat,
        bands: v.bands.map((b) => ({ minG: b.min_g_exclusive, maxG: b.max_g_inclusive, priceCents: b.price_cents })),
        block: v.block_weight_g && v.block_price_cents != null ? { weightG: v.block_weight_g, priceCents: v.block_price_cents } : null,
        maxParcelWeightG: v.max_parcel_weight_g,
        surcharges: v.zone_surcharges.filter((z) => z.amount_cents > 0)
          .map((z) => ({ zoneCode: z.zone_code, amountCents: z.amount_cents, perParcel: z.mode === 'per_parcel' })),
        nonDeliverableZones: v.non_deliverable_zones,
        extraCustomsTerritories: extraCustomsTerritoriesFor(v.country),
        flatRateOverrideCents: rule?.flat_rate_override != null ? Math.round(rule.flat_rate_override * 100) : null,
        discount: rule?.discount_type && rule.discount_value ? { type: rule.discount_type, value: rule.discount_value } : null,
        freeShippingAboveCents: rule?.free_shipping_above != null ? Math.round(rule.free_shipping_above * 100) : null,
      };
    });
}

/**
 * Griglia del tenant, o [] se la pagina non è abilitata
 * (`shipping_public_grid_enabled`, default false) o se il tenant non è in modalità `tariff`.
 */
export async function loadPublicTariffGrid(
  supabase: ServiceClient,
  tenant: { id: string; shipping_pricing_mode?: string | null; shipping_public_grid_enabled?: boolean | null },
): Promise<PublicTariffCountry[]> {
  if (tenant.shipping_public_grid_enabled !== true || tenant.shipping_pricing_mode !== 'tariff') return [];
  const [versionsResult, rulesResult] = await Promise.all([
    supabase.from('shipping_tariff_versions').select('*').eq('tenant_id', tenant.id).eq('status', 'active'),
    supabase.from('shipping_country_rules')
      .select('countries, free_shipping_above, flat_rate_override, discount_type, discount_value')
      .eq('tenant_id', tenant.id).eq('active', true),
  ]);
  if (versionsResult.error) return [];
  return buildPublicGrid((versionsResult.data ?? []) as ShippingTariffVersionRow[], (rulesResult.data ?? []) as ShippingCountryRule[]);
}

/** Etichette leggibili delle zone (geografia, non prezzi); fallback sul codice. */
const ZONE_LABELS: Record<string, { fr: string; it: string }> = {
  IT_SICILY: { fr: 'Sicile', it: 'Sicilia' },
  IT_SARDINIA: { fr: 'Sardaigne', it: 'Sardegna' },
  IT_CALABRIA: { fr: 'Calabre', it: 'Calabria' },
  IT_VENICE_LAGOON: { fr: 'Lagune de Venise', it: 'Laguna di Venezia' },
  IT_MINOR_ISLANDS: { fr: 'Îles mineures', it: 'Isole minori' },
  IT_EXTRA_CUSTOMS: { fr: 'Territoires extra-douaniers', it: 'Territori extra-doganali' },
};

export function zoneLabel(code: string, locale: string): string {
  const known = ZONE_LABELS[code];
  if (known) return locale === 'it' ? known.it : known.fr;
  const tail = code.replace(/^[A-Z]{2}_/, '').replace(/_/g, ' ').toLowerCase();
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}
