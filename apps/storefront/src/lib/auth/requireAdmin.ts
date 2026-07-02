import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Guard per le route API admin.
 *
 * Le pagine /admin sono protette dal layout (protected), ma le route API
 * sono chiamabili direttamente: ogni handler deve invocare questo guard
 * prima di usare il service client (che bypassa RLS).
 *
 * @returns null se l'utente è autenticato e in whitelist ADMIN_EMAILS,
 *          altrimenti la NextResponse 401/403 da restituire subito.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const cookieStore = cookies();

  // Provide both old (get/set/remove) and new (getAll/setAll) cookie APIs.
  // @supabase/ssr@0.3.x reads cookies via get(name) internally, not getAll().
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

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase());

  if (!adminEmails.includes(user.email?.toLowerCase() ?? '')) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }

  return null;
}
