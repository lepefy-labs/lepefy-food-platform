import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

// Endpoint aggiunto (non nella spec) — necessario per la sezione admin
// "Ricerca customer + bottone Accorder l'accès parrainage" della sezione D.
// Query param sanificato (solo alfanumerico/spazio/@/-/.) prima di finire
// nella stringa di filtro PostgREST .or(), per evitare che un carattere come
// virgola o parentesi alteri la struttura del filtro stesso.
export async function GET(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const raw = req.nextUrl.searchParams.get('q') ?? '';
  const q = raw.trim().replace(/[^a-zA-Z0-9À-ÿ@._\- ]/g, '').slice(0, 60);

  if (q.length < 2) {
    return NextResponse.json({ customers: [] });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('customers')
    .select('id, email, full_name, referral_access_granted, referral_access_reason, referral_suspended')
    .eq('tenant_id', tenant.id)
    .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ customers: data ?? [] });
}
