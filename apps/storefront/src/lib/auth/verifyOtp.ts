import type { Session, SupabaseClient } from '@supabase/supabase-js';

export async function verifyOtp(
  supabase: SupabaseClient,
  email: string,
  token: string,
  tenantId: string,
): Promise<{ session: Session | null; error?: string }> {
  // signInWithOtp({ shouldCreateUser: true }) verifica normalmente con
  // type: 'email' sia per un utente nuovo che esistente. Per sicurezza —
  // alcune versioni/configurazioni GoTrue instradano il primo login di un
  // utente appena creato sul flow 'signup' invece di 'email', facendo
  // fallire silenziosamente la verifica con "Token has expired or is
  // invalid" anche con un codice corretto — riproviamo con type: 'signup'
  // prima di arrenderci.
  let { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });

  if (error || !data.session) {
    const retry = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
    data  = retry.data;
    error = retry.error;
  }

  if (error || !data.session) {
    console.error('[auth] verifyOtp error:', error?.message);
    return { session: null, error: error?.message };
  }

  // Upsert su `customers` — ON CONFLICT (tenant_id, email) DO NOTHING: se un
  // customer con questa email esisteva già (es. da un checkout guest
  // precedente), non sovrascriviamo full_name/phone già raccolti.
  const { error: upsertError } = await supabase
    .from('customers')
    .upsert(
      { id: data.session.user.id, tenant_id: tenantId, email },
      { onConflict: 'tenant_id,email', ignoreDuplicates: true },
    );

  if (upsertError) {
    console.error('[auth] customers upsert error:', upsertError.message);
  }

  return { session: data.session };
}
