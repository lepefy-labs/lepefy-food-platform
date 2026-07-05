import { createClient } from '@/lib/supabase/server';
import type { TenantSocialLink } from '@lepefy/types';

export async function getTenantSocialLinks(tenantId: string): Promise<TenantSocialLink[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('tenant_social_links')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[getTenantSocialLinks] errore:', error.message);
    return [];
  }

  return (data ?? []) as TenantSocialLink[];
}
