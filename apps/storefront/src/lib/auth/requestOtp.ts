import { createClient } from '@/lib/supabase/server';
import { hasTenantCustomerWithEmail } from './customerSignIn';
import { authMailRedirectOptions } from '@/lib/authMailer/otpContext';
import { normalizeCustomerEmail } from '@/lib/customers/normalizeCustomerIdentity';

export async function requestOtp(
  email: string,
  tenantId: string,
): Promise<{ sent: boolean; error?: string; isNewCustomer?: boolean }> {
  const supabase = createClient();
  const normalizedEmail = normalizeCustomerEmail(email);
  if (!normalizedEmail) return { sent: false, error: 'Email invalide.' };

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
      ...(await authMailRedirectOptions({ tenantId, kind: 'customer', email: normalizedEmail })),
    },
  });

  if (error) {
    console.error('[auth] requestOtp error:', error.message);
    return { sent: false, error: error.message };
  }

  // Pré-check lecture seule, pas d'écriture : pas de garantie de session
  // attachée à ce point (aucun login n'a encore eu lieu), donc client de
  // service comme dans verifyOtp.ts. Sert uniquement à décider si le
  // formulaire doit afficher la case CGV (Ciclo 4) — un nouvel arrivant n'a
  // encore aucune ligne `customers` pour ce tenant.
  const existingCustomer = await hasTenantCustomerWithEmail(tenantId, normalizedEmail);

  return { sent: true, isNewCustomer: !existingCustomer };
}
