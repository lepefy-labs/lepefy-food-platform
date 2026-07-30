import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';

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
  //
  // Eseguita col service client, non col client `supabase` passato a questa
  // funzione: subito dopo verifyOtp(), la sessione restituita in data.session
  // non è ancora detto sia attaccata a quel client per questa stessa richiesta
  // (propagazione cookie/sessione), e una query con client ancora anonimo
  // fallisce con "permission denied for table customers" (anon non ha grant
  // su customers, solo authenticated e service_role). Questo è un controllo
  // interno pre-upsert, non un'azione per conto dell'utente — non c'è motivo
  // di farla dipendere dal timing della sessione.
  const { data: existingCustomer } = await createServiceClient()
    .from('customers')
    .select('id')
    .eq('id', data.session.user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const isNewCustomer = !existingCustomer;

  // Upsert su `customers` — ON CONFLICT (tenant_id, email) DO NOTHING: se un
  // customer con questa email esisteva già (es. da un checkout guest
  // precedente), non sovrascriviamo full_name/phone già raccolti.
  //
  // Stesso motivo del service client usato sopra per existingCustomer: il
  // client `supabase` passato a questa funzione non ha garanzia di avere la
  // sessione appena verificata già attaccata per questa richiesta, quindi un
  // upsert su di esso può fallire con lo stesso "permission denied for table
  // customers" (mascherato finché la query precedente falliva per prima).
  // Anche questo è un write interno di sistema (creazione riga customers a
  // fronte di un signup riuscito), non un'azione the utente esegue "come sé
  // stesso" — nessuna ragione per dipendere dal timing della sessione qui.
  const { error: upsertError } = await createServiceClient()
    .from('customers')
    .upsert(
      { id: data.session.user.id, tenant_id: tenantId, email },
      { onConflict: 'tenant_id,email', ignoreDuplicates: true },
    );

  if (upsertError) {
    // Non un fallimento da loggare e ignorare: se questa riga non viene
    // scritta, l'account auth esiste ma il customer no. Propagare l'errore
    // impedisce alla route di trattare il login come riuscito (e quindi di
    // procedere a registerWithReferral / consumare il cookie referral_code
    // su un signup che in realtà non si è completato).
    console.error('[auth] customers upsert error:', upsertError.message);
    throw upsertError;
  }

  return { session: data.session, isNewCustomer };
}
