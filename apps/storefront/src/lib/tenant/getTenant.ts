import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { SHOP_DISPLAY_TTL_SECONDS, TENANT_CACHE_TAG } from '@/lib/cache/storefrontCache';
import type { Tenant } from '@lepefy/types';

export class TenantNotFoundError extends Error {
  constructor(slug: string) {
    super(`Tenant not found: ${slug}`);
    this.name = 'TenantNotFoundError';
  }
}

// Lu à chaque requête (layouts, pages, routes API) : mis en Data Cache pour
// éviter un aller-retour Supabase systématique. Le cache vit côté serveur
// uniquement — il peut donc contenir les champs privés, jamais exposés tels
// quels aux Client Components (cf. root layout). Invalidé par
// revalidateTenantCache() depuis les routes admin qui modifient `tenants`.
async function readTenant(slug: string): Promise<Tenant | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();
  // Une erreur n'est jamais mise en cache : on lève pour que la requête
  // suivante réessaie au lieu de servir un faux "introuvable" 60 s.
  if (error) throw new Error(`Unable to load tenant ${slug}: ${error.message}`);
  return (data as Tenant | null) ?? null;
}

const loadTenant = unstable_cache(readTenant, ['tenant-by-slug'], { revalidate: 60, tags: [TENANT_CACHE_TAG] });

// Variante « affichage » des pages ISR et de leurs layouts (même tag, donc
// invalidée en même temps) : cf. SHOP_DISPLAY_TTL_SECONDS. Jamais pour une
// décision de paiement, de checkout ou d'API — celles-ci gardent getTenant().
const loadDisplayTenant = unstable_cache(readTenant, ['tenant-by-slug-display'], { revalidate: SHOP_DISPLAY_TTL_SECONDS, tags: [TENANT_CACHE_TAG] });

async function resolveTenant(load: (slug: string) => Promise<Tenant | null>, slug: string): Promise<Tenant> {
  let tenant: Tenant | null;
  try {
    tenant = await load(slug);
  } catch {
    throw new TenantNotFoundError(slug);
  }
  if (!tenant) throw new TenantNotFoundError(slug);
  return tenant;
}

// Tenant configuration can contain server-only values (for example provider
// API keys and private assistant context). Resolve the canonical tenant with
// the service-role client and only expose a sanitized projection to Client
// Components at the layout boundary.
//
// createServiceClient() does not read cookies, so this remains safe to call
// from the root layout without making the result user-specific.
export const getTenant = cache((slug: string): Promise<Tenant> => resolveTenant(loadTenant, slug));

/** Pages ISR de la boutique et leurs layouts uniquement (affichage). */
export const getDisplayTenant = cache((slug: string): Promise<Tenant> => resolveTenant(loadDisplayTenant, slug));
