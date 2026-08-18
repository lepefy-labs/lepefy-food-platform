import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function requestOtp(
  email: string,
  tenantId: string,
): Promise<{ sent: boolean; error?: string; isNewCustomer?: boolean }> {
  const supabase = createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
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
  const { data: existingCustomer } = await createServiceClient()
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('email', email)
    .maybeSingle();

  return { sent: true, isNewCustomer: !existingCustomer };
}
