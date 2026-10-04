import { createServiceClient } from '@/lib/supabase/server';
import type { ReferralAccessReason } from '@lepefy/types';

/** Callers in background flows may ignore it; admin routes map it to HTTP. */
export type ReferralAccessResult = { ok: true } | { ok: false; reason: 'not_found' | 'error' };

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
}): Promise<ReferralAccessResult> {
  const { tenantId, customerId, reason, grantedByAdminId } = params;
  const supabase = createServiceClient();

  const { data: existing, error: readError } = await supabase
    .from('customers')
    .select('referral_access_granted')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (readError) return { ok: false, reason: 'error' };
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.referral_access_granted) return { ok: true };

  const { error } = await supabase
    .from('customers')
    .update({
      referral_access_granted: true,
      referral_access_reason: reason,
      referral_access_granted_at: new Date().toISOString(),
      referral_access_granted_by: grantedByAdminId ?? null,
    })
    .eq('id', customerId)
    .eq('tenant_id', tenantId);
  return error ? { ok: false, reason: 'error' } : { ok: true };
}

export async function revokeReferralAccess(params: {
  tenantId: string;
  customerId: string;
}): Promise<ReferralAccessResult> {
  const { tenantId, customerId } = params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('customers')
    .update({ referral_access_granted: false })
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .select('id');
  if (error) return { ok: false, reason: 'error' };
  return data && data.length > 0 ? { ok: true } : { ok: false, reason: 'not_found' };
}
