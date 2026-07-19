import { cache } from 'react';
import { createPublicClient } from '@/lib/supabase/public';
import type { Tenant } from '@lepefy/types';

export class TenantNotFoundError extends Error {
  constructor(slug: string) {
    super(`Tenant not found: ${slug}`);
    this.name = 'TenantNotFoundError';
  }
}

// Client public (pas de cookies()) : getTenant() ne lit jamais rien de
// personnalisé par utilisateur (nom, couleurs, config), et le layout racine
// l'appelle sur CHAQUE route — un client lié aux cookies ici forçait tout le
// site en dynamique, y compris les routes qui n'en ont aucun besoin.
export const getTenant = cache(async (slug: string): Promise<Tenant> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('active', true)
    .single();

  if (error || !data) throw new TenantNotFoundError(slug);
  return data as Tenant;
});
