import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// GET n'est pas dans la spec littérale mais nécessaire pour que le panneau
// admin affiche l'historique des pourcentages par niveau.
export async function GET() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('tenant_referral_tiers')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('level', { ascending: true })
    .order('effective_from', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tiers: data ?? [] });
}

// Inserisce SEMPRE una nuova riga versionata e disattiva la precedente per lo
// stesso livello — mai un semplice UPDATE della percentuale (vedi commento
// su tenant_referral_tiers nella migration 040).
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { level?: number; pct?: number };
  if (typeof body.level !== 'number' || body.level < 1) {
    return NextResponse.json({ error: 'Niveau invalide.' }, { status: 400 });
  }
  if (typeof body.pct !== 'number' || body.pct < 0 || body.pct > 1) {
    return NextResponse.json({ error: 'Pourcentage invalide (0-1).' }, { status: 400 });
  }

  const adminId   = await getAdminId();
  const supabase  = createServiceClient();

  const { error: deactivateError } = await supabase
    .from('tenant_referral_tiers')
    .update({ is_active: false })
    .eq('tenant_id', tenant.id)
    .eq('level', body.level)
    .eq('is_active', true);

  if (deactivateError) {
    return NextResponse.json({ error: deactivateError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('tenant_referral_tiers')
    .insert({
      tenant_id: tenant.id,
      level: body.level,
      pct: body.pct,
      is_active: true,
      created_by: adminId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
