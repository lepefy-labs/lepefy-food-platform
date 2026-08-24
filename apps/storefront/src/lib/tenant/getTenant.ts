import { cache } from 'react';
import { createServiceClient } from '@/lib/supabase/server';
import type { Tenant } from '@lepefy/types';

export class TenantNotFoundError extends Error {
  constructor(slug: string) {
    super(`Tenant not found: ${slug}`);
    this.name = 'TenantNotFoundError';
  }
}

// Tenant configuration can contain server-only values (for example provider
// API keys and private assistant context). Resolve the canonical tenant with
// the service-role client and only expose a sanitized projection to Client
// Components at the layout boundary.
//
// createServiceClient() does not read cookies, so this remains safe to call
// from the root layout without making the result user-specific.
export const getTenant = cache(async (slug: string): Promise<Tenant> => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('active', true)
    .single();

  if (error || !data) throw new TenantNotFoundError(slug);
  return data as Tenant;
});