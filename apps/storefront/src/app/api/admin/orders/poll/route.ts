import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export async function GET(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const authError = await requireAdmin(tenant.id);
  if (authError) return authError;

  const since = req.nextUrl.searchParams.get('since'); // ISO timestamp, ultimo controllo del client
  if (!since) {
    return NextResponse.json({ error: 'Paramètre since manquant.' }, { status: 400 });
  }

  const admin  = createServiceClient();

  // Basta sapere SE qualcosa è cambiato dopo `since` — non serve restituire i
  // dati completi qui, il client rifà un fetch/refresh vero se la risposta lo indica.
  const { data: newOrders, error: e1 } = await admin
    .from('orders')
    .select('id, created_at')
    .eq('tenant_id', tenant.id)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5);

  const { count: changedCount, error: e2 } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .gt('updated_at', since);

  if (e1 || e2) {
    return NextResponse.json({ error: (e1 ?? e2)?.message }, { status: 500 });
  }

  return NextResponse.json({
    hasChanges: (newOrders?.length ?? 0) > 0 || (changedCount ?? 0) > 0,
    newOrders:  newOrders ?? [],       // per il toast "Nouvelle commande"
    checkedAt:  new Date().toISOString(),
  });
}
