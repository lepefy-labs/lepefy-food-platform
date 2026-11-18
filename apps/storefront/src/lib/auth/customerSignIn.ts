import type { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeCustomerEmail } from '@/lib/customers/normalizeCustomerIdentity';
import { registerWithReferral } from '@/lib/loyalty/registerWithReferral';
import { registerSignupConsent } from '@/lib/legal/registerSignupConsent';

// Steps shared by every customer sign-in method (e-mail code, Google).

/**
 * Whether this e-mail already has a `customers` row in the tenant (normalized
 * or legacy e-mail). Read-only, service client: no session exists yet. Decides
 * whether the CGV consent must be asked before the first sign-in.
 */
export async function hasTenantCustomerWithEmail(tenantId: string, email: string): Promise<boolean> {
  const normalizedEmail = normalizeCustomerEmail(email);
  if (!normalizedEmail) return false;
  const service = createServiceClient();
  const [normalizedMatch, legacyMatch] = await Promise.all([
    service.from('customers').select('id').eq('tenant_id', tenantId).eq('normalized_email', normalizedEmail).limit(1).maybeSingle(),
    service.from('customers').select('id').eq('tenant_id', tenantId).ilike('email', normalizedEmail).limit(1).maybeSingle(),
  ]);
  return Boolean(normalizedMatch.data ?? legacyMatch.data);
}

/**
 * After a successful sign-in: CGV/marketing consent and referral attribution,
 * only on the customer's first sign-in. Best-effort — a failure here never
 * invalidates an account that was already created.
 */
export async function finishCustomerSignIn(params: {
  req: NextRequest;
  response: NextResponse;
  tenantId: string;
  customerId: string;
  isNewCustomer: boolean;
  marketingOptIn: boolean;
  logTag: string;
}): Promise<void> {
  const { req, response, tenantId, customerId, isNewCustomer, marketingOptIn, logTag } = params;
  if (!isNewCustomer) return;

  try {
    await registerSignupConsent({ tenantId, customerId, marketingOptIn });
  } catch (consentErr) {
    console.error(`[${logTag}] registerSignupConsent failed:`, consentErr, '— customer_id:', customerId);
  }

  // Referral: only when /invite/[code] left a cookie. A definitive outcome
  // (referred or refused with a reason) consumes the cookie; an unexpected
  // exception keeps it for a retry within its 30 days.
  const referralCookie = req.cookies.get('referral_code')?.value;
  if (!referralCookie) return;

  const forwardedFor = req.headers.get('x-forwarded-for');
  const signupIp = forwardedFor?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '';

  try {
    await registerWithReferral({
      tenantId,
      newCustomerId: customerId,
      referralCode: referralCookie,
      signupIp,
      // No device fingerprinting exists in the project: checkFraudSignals
      // compares an empty string, which never yields a SAME_DEVICE match.
      deviceFingerprint: '',
    });
    response.cookies.delete('referral_code');
  } catch (referralErr) {
    console.error(`[${logTag}] registerWithReferral failed:`, referralErr, '— customer_id:', customerId);
  }
}
