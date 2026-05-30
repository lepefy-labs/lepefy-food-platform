import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Tenant } from '@lepefy/types';

export class TenantNotFoundError extends Error {
  constructor(slug: string) {
    super(`Tenant not found: ${slug}`);
    this.name = 'TenantNotFoundError';
  }
}

export const getTenant = cache(async (slug: string): Promise<Tenant> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('active', true)
    .single();

  if (error || !data) throw new TenantNotFoundError(slug);
  return data as Tenant;
});
