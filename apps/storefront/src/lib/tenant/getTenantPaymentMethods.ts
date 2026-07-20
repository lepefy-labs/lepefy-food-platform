import { createPublicClient } from '@/lib/supabase/public';
import type { TenantPaymentMethod } from '@lepefy/types';

export async function getTenantPaymentMethods(tenantId: string): Promise<TenantPaymentMethod[]> {
  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from('tenant_payment_methods')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[getTenantPaymentMethods] errore:', error.message);
    return [];
  }

  return (data ?? []) as TenantPaymentMethod[];
}
