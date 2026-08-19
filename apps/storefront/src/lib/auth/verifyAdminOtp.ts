import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';

export async function verifyAdminOtp(
  supabase: SupabaseClient,
  email: string,
  token: string,
): Promise<{ session: Session | null; error?: string }> {
  // Même filet défensif que verifyOtp.ts (flux client) : certaines
  // versions/configurations GoTrue acheminent le tout premier login d'un
  // utilisateur créé récemment sur le flow 'signup' au lieu de 'email',
  // faisant échouer silencieusement la vérification malgré un code correct.
  // Coût minimal, cohérence avec le pattern existant — même si avec
  // shouldCreateUser: false ce cas ne devrait normalement jamais se produire.
  let { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });

  if (error || !data.session) {
    const retry = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
    data  = retry.data;
    error = retry.error;
  }

  if (error || !data.session) {
    console.error('[admin] verifyAdminOtp error:', error?.message);
    return { session: null, error: error?.message };
  }

  // Recontrôle qu'une ligne admin_users active existe toujours pour cet
  // utilisateur — cas limite : désactivé entre la demande du code et sa
  // vérification. Fail-fast avec message explicite, même si le layout
  // (protected) recontrôlera de toute façon après coup.
  const { data: admin } = await createServiceClient()
    .from('admin_users')
    .select('id')
    .eq('id', data.session.user.id)
    .eq('active', true)
    .maybeSingle();

  if (!admin) {
    return { session: null, error: 'Accès refusé.' };
  }

  return { session: data.session };
}
