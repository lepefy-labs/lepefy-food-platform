/**
 * Lecture serveur de la politique géographique et contrôle du panier.
 * Tout vient de la base du tenant: le navigateur n'envoie ni classement de
 * conservation, ni autorisation de pays.
 */

import type { createServiceClient } from '@/lib/supabase/server';
import {
  DESTINATION_BLOCKED_MESSAGE, STORAGE_BLOCKED_MESSAGE,
  evaluateStorageRestrictions, geoPolicyFromRow, isDestinationAllowed,
  type GeoPolicy,
} from './geoPolicy';

type ServiceClient = ReturnType<typeof createServiceClient>;

const UNDEFINED_TABLE = '42P01';

export async function loadGeoPolicy(supabase: ServiceClient, tenantId: string): Promise<GeoPolicy> {
  const { data, error } = await supabase
    .from('tenant_shipping_geo_policy')
    .select('destination_mode, included_countries, excluded_countries, provider_fallback_enabled, storage_rules, policy_version')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) {
    // Migration 179 absente: politique neutre (comportement historique).
    if ((error as { code?: string }).code === UNDEFINED_TABLE || /tenant_shipping_geo_policy/.test(error.message ?? '')) {
      return geoPolicyFromRow(null);
    }
    throw new Error('geo_policy_lookup_failed');
  }
  return geoPolicyFromRow(data);
}

/** Pays qui ont aujourd'hui un forfait actif (mode `current`). */
export async function loadConfiguredCountries(supabase: ServiceClient, tenantId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('shipping_tariff_versions')
    .select('country')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');
  // Table absente (avant 124): aucun pays configuré, la liste historique suffit.
  if (error) return [];
  return [...new Set(((data ?? []) as Array<{ country: string }>).map((r) => r.country.toUpperCase()))];
}

export type GeoCheckFailure = {
  ok: false;
  code: 'DESTINATION_NOT_ALLOWED' | 'STORAGE_RESTRICTED';
  message: string;
  blockedProducts: Array<{ id: string; name: string }>;
};
export type GeoCheckResult = { ok: true; policy: GeoPolicy; configuredCountries: string[]; destinationAllowed: true } | GeoCheckFailure;

export interface GeoCheckInput {
  supabase: ServiceClient;
  tenant: { id: string; country?: string | null };
  country: string;
  quantityByProduct: ReadonlyMap<string, number>;
}

export async function checkDeliveryGeo(input: GeoCheckInput): Promise<GeoCheckResult> {
  const { supabase, tenant } = input;
  const policy = await loadGeoPolicy(supabase, tenant.id);
  // Aucune politique enregistrée (version 0): comportement historique, aucune
  // restriction de destination ajoutée. Les forfaits actifs ne sont lus que
  // pour le mode « pays actuellement configurés ».
  const enforceDestination = policy.version > 0;
  const configuredCountries = enforceDestination && policy.destinationMode === 'current'
    ? await loadConfiguredCountries(supabase, tenant.id)
    : [];

  if (enforceDestination && !isDestinationAllowed(policy, input.country, configuredCountries).allowed) {
    return { ok: false, code: 'DESTINATION_NOT_ALLOWED', message: DESTINATION_BLOCKED_MESSAGE, blockedProducts: [] };
  }

  const anyRestriction = Object.values(policy.storageRules).some((r) => r.mode !== 'none');
  if (anyRestriction) {
    // Panier sans produit identifiable: impossible de vérifier → refus.
    if (input.quantityByProduct.size === 0) {
      return { ok: false, code: 'STORAGE_RESTRICTED', message: STORAGE_BLOCKED_MESSAGE, blockedProducts: [] };
    }
    const ids = [...input.quantityByProduct.keys()];
    const { data, error } = await supabase
      .from('products')
      .select('id, name, storage_type')
      .eq('tenant_id', tenant.id)
      .in('id', ids);
    if (error) throw new Error('geo_storage_lookup_failed');
    const rows = (data ?? []) as Array<{ id: string; name: string; storage_type: unknown }>;
    // Un produit absent du tenant n'est jamais accepté ici (isolation multi-tenant).
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id)).map((id) => ({ id, name: 'Produit indisponible' }));
    const evaluation = evaluateStorageRestrictions(
      policy, input.country, tenant.country,
      rows.map((r) => ({ id: r.id, name: r.name, storageType: r.storage_type })),
    );
    const blocked = [...(evaluation.ok ? [] : evaluation.blocked.map((b) => ({ id: b.id, name: b.name }))), ...missing];
    if (blocked.length > 0) {
      return { ok: false, code: 'STORAGE_RESTRICTED', message: STORAGE_BLOCKED_MESSAGE, blockedProducts: blocked };
    }
  }
  return { ok: true, policy, configuredCountries, destinationAllowed: true };
}
