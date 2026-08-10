import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';

interface VoidRpcRow {
  success: boolean;
  reason: string;
  quantity_remaining: number | null;
}

// Annule (soft-void) une redemption ligne précise — jamais de suppression
// physique du log, cf. void_event_reservation_item_redemption (053).
export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id, ['tenant_admin', 'tenant_cashier']);
  if (denied) return denied;

  if (!tenant.events_enabled) {
    return NextResponse.json({ error: 'Module événementiel non activé.' }, { status: 400 });
  }

  const body = await req.json() as { redemption_id?: string; reason?: string };
  const redemptionId = body.redemption_id;

  if (!redemptionId) {
    return NextResponse.json({ error: 'redemption_id requis.' }, { status: 400 });
  }

  const adminId = await getAdminId();
  if (!adminId) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Vérifie que la redemption appartient bien à une réservation de ce tenant
  // AVANT la RPC — même garde-fou que le POST de scan existant.
  const { data: redemption } = await supabase
    .from('event_reservation_item_redemptions')
    .select('id, reservation_item_id, event_reservation_items(reservation_id, event_reservations(tenant_id))')
    .eq('id', redemptionId)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reservationTenantId = (redemption as any)?.event_reservation_items?.event_reservations?.tenant_id;

  if (!redemption || reservationTenantId !== tenant.id) {
    return NextResponse.json({ error: 'Redemption introuvable pour cette boutique.' }, { status: 404 });
  }

  const { data, error } = await supabase
    .rpc('void_event_reservation_item_redemption', {
      p_redemption_id: redemptionId,
      p_admin_id: adminId,
      p_reason: body.reason?.trim() || null,
    })
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data as VoidRpcRow;

  if (!row.success) {
    return NextResponse.json({ error: row.reason }, { status: 409 });
  }

  return NextResponse.json({ success: true, quantity_remaining: row.quantity_remaining });
}
