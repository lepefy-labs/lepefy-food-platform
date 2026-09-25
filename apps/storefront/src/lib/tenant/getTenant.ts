import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { TENANT_CACHE_TAG } from '@/lib/cache/storefrontCache';
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
const loadTenant = unstable_cache(
  async (slug: string): Promise<Tenant | null> => {
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
  },
  ['tenant-by-slug'],
  { revalidate: 60, tags: [TENANT_CACHE_TAG] },
);

// Tenant configuration can contain server-only values (for example provider
// API keys and private assistant context). Resolve the canonical tenant with
// the service-role client and only expose a sanitized projection to Client
// Components at the layout boundary.
//
// createServiceClient() does not read cookies, so this remains safe to call
// from the root layout without making the result user-specific.
export const getTenant = cache(async (slug: string): Promise<Tenant> => {
  let tenant: Tenant | null;
  try {
    tenant = await loadTenant(slug);
  } catch {
    throw new TenantNotFoundError(slug);
  }
  if (!tenant) throw new TenantNotFoundError(slug);
  return tenant;
});
