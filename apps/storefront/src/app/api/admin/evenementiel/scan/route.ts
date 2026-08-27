import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requirePermission } from '@/lib/auth/adminRbac';
import { getAdminId } from '@/lib/auth/getAdminId';
import { extractQrToken } from '@/lib/events/ticketUrl';
import { getEventCheckinWindowState } from '@/lib/events/checkinWindow';

interface RedeemItemsRpcRow {
  success: boolean;
  reservation_item_id: string | null;
  reason: string;
  quantity_remaining: number | null;
}

interface ScanItemInput {
  reservation_item_id: string;
  quantity: number;
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requirePermission(tenant.id, 'scan.redeem');
  if (denied) return denied;

  if (!tenant.events_enabled) {
    return NextResponse.json({ error: 'Module événementiel non activé.' }, { status: 400 });
  }

  const body = await req.json() as { qr_token?: string; event_id?: string; items?: ScanItemInput[] };
  const qrToken = extractQrToken(body.qr_token ?? '');
  const eventId = body.event_id?.trim() ?? '';
  const items = Array.isArray(body.items) ? body.items : [];

  const validItems = items.every(
    item => typeof item.reservation_item_id === 'string' && item.reservation_item_id.length > 0
      && Number.isInteger(item.quantity) && item.quantity > 0,
  );

  if (!qrToken || !eventId || items.length === 0 || !validItems) {
    return NextResponse.json({ error: 'Événement, code QR et lignes de formule valides requis.' }, { status: 400 });
  }

  const adminId = await getAdminId();
  if (!adminId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: reservation } = await supabase
    .from('event_reservations')
    .select('id, tenant_id, event_id, customer_name')
    .eq('qr_token', qrToken)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Code QR invalide pour cette boutique.' }, { status: 404 });
  }
  if (reservation.event_id !== eventId) {
    return NextResponse.json({ error: 'Ce billet appartient à un autre événement.' }, { status: 409 });
  }

  const { data: eventRow } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
  if (!eventRow || eventRow.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Événement introuvable pour cette boutique.' }, { status: 404 });
  }
  if (eventRow.status === 'cancelled' || eventRow.status === 'draft') {
    return NextResponse.json({ error: eventRow.status === 'cancelled' ? 'Événement annulé.' : 'Événement non publié.' }, { status: 409 });
  }

  const windowState = getEventCheckinWindowState(eventRow);
  if (windowState.blockingReason) {
    return NextResponse.json({ error: windowState.blockingReason }, { status: 409 });
  }

  const { data, error } = await supabase
    .rpc('redeem_event_reservation_items', { p_qr_token: qrToken, p_items: items, p_admin_id: adminId })
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = data as RedeemItemsRpcRow;
  if (!row.success) {
    return NextResponse.json({ error: row.reason, reservationItemId: row.reservation_item_id }, { status: 409 });
  }

  return NextResponse.json({
    success: true,
    remaining: row.quantity_remaining,
    customerName: reservation.customer_name,
    eventTitle: eventRow.title ?? null,
  });
}
