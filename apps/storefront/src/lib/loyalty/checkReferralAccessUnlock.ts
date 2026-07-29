import { createServiceClient } from '@/lib/supabase/server';
import { grantReferralAccess } from './grantReferralAccess';

/**
 * No-op salvo mode === SPENDING_THRESHOLD e accesso non ancora concesso.
 * Chiamata solo dall'hook ordine consegnato (processOrderPointsOnDelivery) —
 * mai da un endpoint di lettura, per evitare di ricalcolare lifetimeSpend ad
 * ogni page view.
 *
 * Deviazione minore: lo schema orders non ha una colonna `total_amount` (solo
 * `total`, vedi 001_initial_schema.sql) — la spesa lifetime somma `total`.
 */
export async function checkReferralAccessUnlock(tenantId: string, customerId: string): Promise<void> {
  const supabase = createServiceClient();

  const { data: tenant } = await supabase
    .from('tenants')
    .select('referral_availability_mode, referral_unlock_spending_threshold')
    .eq('id', tenantId)
    .single();

  if (!tenant || tenant.referral_availability_mode !== 'SPENDING_THRESHOLD') return;

  const { data: customer } = await supabase
    .from('customers')
    .select('referral_access_granted')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!customer || customer.referral_access_granted) return;

  const threshold = tenant.referral_unlock_spending_threshold;
  if (threshold == null) return;

  const { data: orders } = await supabase
    .from('orders')
    .select('total')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('status', 'delivered');

  const lifetimeSpend = (orders ?? []).reduce((sum, o) => sum + Number(o.total), 0);

  if (lifetimeSpend >= threshold) {
    await grantReferralAccess({ tenantId, customerId, reason: 'THRESHOLD_MET' });
  }
}
