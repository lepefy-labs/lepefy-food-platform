import { createClient } from '@/lib/supabase/server';

export interface SessionCustomer {
  id:        string;
  email:     string;
  full_name: string | null;
}

// Legge la sessione server-side (Server Component / Route Handler) via il
// client SSR esistente. Ritorna null se non autenticato — non lancia mai,
// il chiamante decide se richiedere login (checkout guest resta valido).
export async function getSessionCustomer(tenantId: string): Promise<SessionCustomer | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: customer } = await supabase
    .from('customers')
    .select('id, email, full_name')
    .eq('id', user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  return customer ?? null;
}
