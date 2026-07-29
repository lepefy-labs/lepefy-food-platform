import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Piccolo helper aggiunto (non nella spec) per evitare di duplicare il
 * boilerplate cookie di requireAdmin.ts nelle nuove route admin loyalty che
 * devono registrare CHI ha compiuto un'azione (granted_by, created_by).
 * Da chiamare SEMPRE dopo che requireAdmin() ha già autorizzato la richiesta
 * — non fa controlli di permesso propri, legge solo l'id dell'utente Supabase
 * corrente (che coincide con admin_users.id).
 */
export async function getAdminId(): Promise<string | null> {
  const cookieStore = cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
        get(name: string) { return cookieStore.get(name)?.value },
        set() {},
        remove() {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}
