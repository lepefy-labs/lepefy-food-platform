import { createClient, createServiceClient } from '@/lib/supabase/server';
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
    options: { shouldCreateUser: true },
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
  const service = createServiceClient();
  const [normalizedMatch, legacyMatch] = await Promise.all([
    service.from('customers').select('id').eq('tenant_id', tenantId).eq('normalized_email', normalizedEmail).limit(1).maybeSingle(),
    service.from('customers').select('id').eq('tenant_id', tenantId).ilike('email', normalizedEmail).limit(1).maybeSingle(),
  ]);
  const existingCustomer = normalizedMatch.data ?? legacyMatch.data;

  return { sent: true, isNewCustomer: !existingCustomer };
}
