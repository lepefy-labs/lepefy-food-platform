import { createServiceClient } from '@/lib/supabase/server';
import { checkFraudSignals } from './checkFraudSignals';
import { grantReferralAccess } from './grantReferralAccess';

type RegisterWithReferralResult =
  | { referred: true; sponsorId: string }
  | { referred: false; reason: 'invalid_code' | 'code_exhausted' | 'self_referral_blocked' | 'fraud_signal_detected' };

/**
 * `referralCode` è opzionale nella firma: questa funzione è pensata per
 * essere chiamata ad OGNI signup, non solo quelli arrivati con un codice.
 * Questo perché lo step 6 (grant automatico in modalità ALL_CUSTOMERS) deve
 * applicarsi a qualunque nuovo customer, referral o meno — se il chiamante
 * invocasse questa funzione solo in presenza di un codice, un tenant in
 * ALL_CUSTOMERS non sbloccherebbe mai l'eleggibilità per i signup organici.
 * Senza codice, step 1-5 (validazione/frode/bonus) sono no-op e la funzione
 * ritorna `{ referred: false, reason: 'invalid_code' }` — il tipo di ritorno
 * vincolante dal prompt non prevede un motivo dedicato "nessun codice fornito",
 * quindi si riusa il motivo più vicino invece di estendere l'union type.
 */
export async function registerWithReferral(params: {
  tenantId: string;
  newCustomerId: string;
  referralCode?: string;
  signupIp: string;
  deviceFingerprint: string;
}): Promise<RegisterWithReferralResult> {
  const { tenantId, newCustomerId, referralCode, signupIp, deviceFingerprint } = params;
  const supabase = createServiceClient();

  const { data: tenant } = await supabase
    .from('tenants')
    .select('referral_signup_bonus_points, referral_availability_mode')
    .eq('id', tenantId)
    .single();

  async function grantDefaultAccessIfApplicable() {
    if (tenant?.referral_availability_mode === 'ALL_CUSTOMERS') {
      await grantReferralAccess({ tenantId, customerId: newCustomerId, reason: 'DEFAULT_ENABLED' });
    }
  }

  if (!referralCode) {
    await grantDefaultAccessIfApplicable();
    return { referred: false, reason: 'invalid_code' };
  }

  // ── 1. Valida referral_codes ──────────────────────────────────────────────
  const { data: codeRow } = await supabase
    .from('referral_codes')
    .select('id, owner_customer_id, is_active, max_uses, uses_count')
    .eq('tenant_id', tenantId)
    .eq('code', referralCode)
    .maybeSingle();

  if (!codeRow || !codeRow.is_active) {
    await grantDefaultAccessIfApplicable();
    return { referred: false, reason: 'invalid_code' };
  }

  if (codeRow.max_uses != null && codeRow.uses_count >= codeRow.max_uses) {
    await grantDefaultAccessIfApplicable();
    return { referred: false, reason: 'code_exhausted' };
  }

  const sponsorId = codeRow.owner_customer_id as string;

  // ── 2. Blocca auto-referral ───────────────────────────────────────────────
  if (sponsorId === newCustomerId) {
    await grantDefaultAccessIfApplicable();
    return { referred: false, reason: 'self_referral_blocked' };
  }

  // ── 3. checkFraudSignals — solo IP/device qui; telefono/indirizzo non
  //      ancora noti a signup, verificati nell'hook ordine ────────────────
  const { data: sponsor } = await supabase
    .from('customers')
    .select('signup_ip, signup_device_fingerprint')
    .eq('id', sponsorId)
    .single();

  const { detected } = await checkFraudSignals({
    tenantId,
    newCustomerId,
    sponsorId,
    signals: { SAME_IP: signupIp, SAME_DEVICE: deviceFingerprint },
    sponsorSignals: {
      SAME_IP: sponsor?.signup_ip ?? null,
      SAME_DEVICE: sponsor?.signup_device_fingerprint ?? null,
    },
  });

  if (detected) {
    await grantDefaultAccessIfApplicable();
    return { referred: false, reason: 'fraud_signal_detected' };
  }

  // ── 4. RPC apply_referral_on_signup ───────────────────────────────────────
  const { error: rpcError } = await supabase.rpc('apply_referral_on_signup', {
    p_tenant_id: tenantId,
    p_new_customer_id: newCustomerId,
    p_referred_by_id: sponsorId,
    p_referral_code_id: codeRow.id,
    p_signup_ip: signupIp,
    p_device_fingerprint: deviceFingerprint,
  });
  if (rpcError) throw rpcError;

  // ── 5. Signup bonus (per il nuovo customer, in stato PENDING) ─────────────
  if (tenant && tenant.referral_signup_bonus_points > 0) {
    await supabase.from('points_ledger').insert({
      tenant_id: tenantId,
      customer_id: newCustomerId,
      amount: tenant.referral_signup_bonus_points,
      status: 'PENDING',
      transaction_type: 'SIGNUP_BONUS',
      reference_customer_id: sponsorId,
    });
  }

  // ── 6. Grant accesso default se ALL_CUSTOMERS ─────────────────────────────
  await grantDefaultAccessIfApplicable();

  return { referred: true, sponsorId };
}
