import type { Session, SupabaseClient } from '@supabase/supabase-js';

export async function verifyOtp(
  supabase: SupabaseClient,
  email: string,
  token: string,
  tenantId: string,
): Promise<{ session: Session | null; error?: string }> {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });

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
