import { createServiceClient } from '@/lib/supabase/server';
import type { ReferralAccessReason } from '@lepefy/types';

/**
 * Sblocca l'eleggibilità a generare un codice referral. Condivisa da
 * registerWithReferral (DEFAULT_ENABLED), checkReferralAccessUnlock
 * (THRESHOLD_MET) e dalla route admin grant-referral-access (ADMIN_GRANTED).
 * No-op se già granted, per non sovrascrivere granted_at/reason di un grant
 * precedente con una causa diversa.
 */
export async function grantReferralAccess(params: {
  tenantId: string;
  customerId: string;
  reason: ReferralAccessReason;
  grantedByAdminId?: string;
}): Promise<void> {
  const { tenantId, customerId, reason, grantedByAdminId } = params;
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('customers')
    .select('referral_access_granted')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existing?.referral_access_granted) return;

  await supabase
    .from('customers')
    .update({
      referral_access_granted: true,
      referral_access_reason: reason,
      referral_access_granted_at: new Date().toISOString(),
      referral_access_granted_by: grantedByAdminId ?? null,
    })
    .eq('id', customerId)
    .eq('tenant_id', tenantId);
}

export async function revokeReferralAccess(params: {
  tenantId: string;
  customerId: string;
}): Promise<void> {
  const { tenantId, customerId } = params;
  const supabase = createServiceClient();

  await supabase
    .from('customers')
    .update({ referral_access_granted: false })
    .eq('id', customerId)
    .eq('tenant_id', tenantId);
}
