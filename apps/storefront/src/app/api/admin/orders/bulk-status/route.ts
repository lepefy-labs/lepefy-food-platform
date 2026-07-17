import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Whitelist rigida degli stati raggiungibili in bulk — niente 'cancelled':
// tocca rimborsi Stripe, va gestito singolarmente (nota audit §10).
const ALLOWED_BULK_STATUSES = ['shipped', 'ready_for_pickup'];

export async function POST(req: NextRequest) {
  const authError = await requireAdmin();
  if (authError) return authError;

  const { orderIds, status } = await req.json();

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds manquant ou vide.' }, { status: 400 });
  }
  if (!ALLOWED_BULK_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Statut non autorisé pour une mise à jour groupée.' }, { status: 400 });
  }

  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const admin  = createServiceClient();

  const { data, error } = await admin
    .from('orders')
    .update({ status })
    .in('id', orderIds)
    .eq('tenant_id', tenant.id)  // scoping esplicito: il service client bypassa RLS,
                                 // senza questo filtro un ID di un altro tenant passerebbe
    .select('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ updated: data?.length ?? 0 });
}
