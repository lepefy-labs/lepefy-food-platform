import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id, ['tenant_admin', 'tenant_cashier']);
  if (denied) return denied;

  const eventId = req.nextUrl.searchParams.get('event_id')?.trim() ?? '';
  if (!eventId) return NextResponse.json({ error: 'event_id requis.' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, tenant_id')
    .eq('id', eventId)
    .maybeSingle();

  if (!event || event.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });
  }

  const { data: reservations, error } = await supabase
    .from('event_reservations')
    .select('quantity_total, quantity_remaining, status')
    .eq('event_id', eventId)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const confirmed = (reservations ?? []).filter(row => row.status === 'confirmed');
  const rightsTotal = confirmed.reduce((sum, row) => sum + Number(row.quantity_total || 0), 0);
  const rightsRemaining = confirmed.reduce((sum, row) => sum + Number(row.quantity_remaining || 0), 0);
  const rightsRedeemed = Math.max(0, rightsTotal - rightsRemaining);
  const reservationsStarted = confirmed.filter(row => Number(row.quantity_remaining) < Number(row.quantity_total)).length;

  return NextResponse.json({
    reservations: confirmed.length,
    reservations_started: reservationsStarted,
    rights_total: rightsTotal,
    rights_redeemed: rightsRedeemed,
    rights_remaining: rightsRemaining,
    updated_at: new Date().toISOString(),
  });
}
