import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';

export type AdminRole = 'platform_owner' | 'tenant_admin' | 'tenant_cashier';

/**
 * Guard per le route API admin.
 *
 * Le pagine /admin sono protette dal layout (protected), ma le route API
 * sono chiamabili direttamente: ogni handler deve invocare questo guard
 * prima di usare il service client (che bypassa RLS).
 *
 * @param tenantId tenant della route corrente — un tenant_admin/tenant_cashier
 *   viene rifiutato se non combacia con il proprio tenant_id in `admin_users`.
 * @param allowedRoles ruoli ammessi per QUESTA chiamata, oltre a platform_owner
 *   (sempre ammesso, accesso globale — invariato). Default `['tenant_admin']`:
 *   nessun cambiamento di comportamento per le route esistenti, che non
 *   passano questo parametro (047_loyalty_card_system.sql — introduzione del
 *   ruolo tenant_cashier). Passare `['tenant_admin', 'tenant_cashier']` solo
 *   sulle route dove il personale di cassa deve poter operare.
 * @returns null se l'utente è autenticato e autorizzato per questo tenant,
 *          altrimenti la NextResponse 401/403 da restituire subito.
 */
export async function requireAdmin(
  tenantId: string,
  allowedRoles: AdminRole[] = ['tenant_admin'],
): Promise<NextResponse | null> {
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

  // admin_users n'a aucune policy publique (service_role uniquement) — le
  // client anon/authenticated ci-dessus ne peut pas la lire directement.
  const adminClient = createServiceClient();

  const { data: admin } = await adminClient
    .from('admin_users')
    .select('id, role, tenant_id, active')
    .eq('id', user.id)
    .eq('active', true)
    .single();

  if (!admin) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }

  if (admin.role === 'platform_owner') {
    return null; // accesso globale, indipendente da allowedRoles — invariato
  }

  if (!allowedRoles.includes(admin.role as AdminRole)) {
    return NextResponse.json({ error: 'Accès refusé pour ce rôle.' }, { status: 403 });
  }

  if (admin.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Accès refusé pour ce tenant.' }, { status: 403 });
  }

  return null;
}
