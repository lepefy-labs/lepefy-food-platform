import type { Session, SupabaseClient } from '@supabase/supabase-js';

export async function verifyOtp(
  supabase: SupabaseClient,
  email: string,
  token: string,
  tenantId: string,
): Promise<{ session: Session | null; error?: string; isNewCustomer?: boolean }> {
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

  // "Primo login/creazione" (serve a registerWithReferral, vedi verify-otp
  // route): unico modo affidabile è verificare l'assenza pregressa della riga
  // `customers` per questo id PRIMA dell'upsert sottostante — user.created_at
  // non è usato perché non distingue "utente auth appena creato" da "riga
  // customers già esistente per altra via" con la stessa affidabilità di una
  // query diretta sulla tabella che stiamo per scrivere.
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('id')
    .eq('id', data.session.user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const isNewCustomer = !existingCustomer;

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

  return { session: data.session, isNewCustomer };
}
