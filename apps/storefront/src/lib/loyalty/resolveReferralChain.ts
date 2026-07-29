import { createServiceClient } from '@/lib/supabase/server';

interface ResolveReferralChainRow {
  customer_id: string;
  level: number;
}

/**
 * Chiama RPC resolve_referral_chain. Nessuna logica ricorsiva lato Node — la
 * profondità è dinamica per tenant (tenants.referral_max_depth) e la CTE
 * ricorsiva lato SQL è già limitata a p_max_depth.
 */
export async function resolveReferralChain(
  tenantId: string,
  customerId: string,
  maxDepth: number,
): Promise<{ customerId: string; level: number }[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('resolve_referral_chain', {
    p_tenant_id: tenantId,
    p_customer_id: customerId,
    p_max_depth: maxDepth,
  });

  if (error) throw error;

  return ((data ?? []) as ResolveReferralChainRow[]).map((row) => ({
    customerId: row.customer_id,
    level: row.level,
  }));
}
