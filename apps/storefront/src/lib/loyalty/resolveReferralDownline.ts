import { createServiceClient } from '@/lib/supabase/server';

interface ResolveReferralDownlineRow {
  customer_id: string;
  level: number;
}

/**
 * Aggiunta non presente nella spec (che indicava resolveReferralChain per
 * l'endpoint /tree) — vedi commento in resolve_referral_downline nella
 * migration 040 per la motivazione. Stessa forma di ritorno di
 * resolveReferralChain, ma percorre la rete verso i discendenti (invitati),
 * non verso gli sponsor.
 */
export async function resolveReferralDownline(
  tenantId: string,
  customerId: string,
  maxDepth: number,
): Promise<{ customerId: string; level: number }[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('resolve_referral_downline', {
    p_tenant_id: tenantId,
    p_customer_id: customerId,
    p_max_depth: maxDepth,
  });

  if (error) throw error;

  return ((data ?? []) as ResolveReferralDownlineRow[]).map((row) => ({
    customerId: row.customer_id,
    level: row.level,
  }));
}
