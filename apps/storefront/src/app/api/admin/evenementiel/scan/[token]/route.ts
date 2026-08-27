import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { canAdmin, getCurrentAdminAccessContext, requirePermission } from '@/lib/auth/adminRbac';
import { getAdminId } from '@/lib/auth/getAdminId';
import { extractQrToken } from '@/lib/events/ticketUrl';
import { getEventCheckinWindowState } from '@/lib/events/checkinWindow';

const CASHIER_UNDO_WINDOW_MS = 5 * 60 * 1000;

interface ItemRow { id: string; ticket_type_id: string; quantity: number; }
interface RedemptionRow {
  id: string;
  reservation_item_id: string;
  quantity_redeemed: number;
  redeemed_at: string;
  redeemed_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

export interface ScanPreviewItem {
  reservation_item_id: string;
  ticket_type_name: string;
  quantity_totale: number;
  quantity_redenta_netta: number;
  ultima_redemption: {
    id: string;
    quantity: number;
    redeemed_at: string;
    redeemed_by_name: string | null;
    can_undo: boolean;
    undo_requires_reason: boolean;
  } | null;
}

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requirePermission(tenant.id, 'scan.access');
  if (denied) return denied;

  if (!tenant.events_enabled) return NextResponse.json({ error: 'Module événementiel non activé.' }, { status: 400 });

  const eventId = req.nextUrl.searchParams.get('event_id')?.trim() ?? '';
  if (!eventId) return NextResponse.json({ error: 'Événement à contrôler requis.' }, { status: 400 });

  const qrToken = extractQrToken(decodeURIComponent(params.token));
  if (!qrToken) return NextResponse.json({ error: 'Code QR invalide.' }, { status: 400 });

  const adminId = await getAdminId();
  if (!adminId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });

  const supabase = createServiceClient();
  const { data: reservation } = await supabase
    .from('event_reservations')
    .select('id, tenant_id, event_id, customer_name, quantity_total, quantity_remaining, status')
    .eq('qr_token', qrToken)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) return NextResponse.json({ error: 'Code QR invalide pour cette boutique.' }, { status: 404 });
  if (reservation.event_id !== eventId) return NextResponse.json({ error: 'Ce billet appartient à un autre événement.' }, { status: 409 });

  const { data: eventRow } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
  if (!eventRow || eventRow.tenant_id !== tenant.id) return NextResponse.json({ error: 'Événement introuvable pour cette boutique.' }, { status: 404 });

  const { data: items } = await supabase
    .from('event_reservation_items')
    .select('id, ticket_type_id, quantity')
    .eq('reservation_id', reservation.id) as { data: ItemRow[] | null };

  const itemRows = items ?? [];
  const { data: ticketTypes } = await supabase
    .from('event_ticket_types')
    .select('id, label')
    .in('id', itemRows.length ? itemRows.map(item => item.ticket_type_id) : ['00000000-0000-0000-0000-000000000000']);
  const labelById = new Map((ticketTypes ?? []).map(ticketType => [ticketType.id, ticketType.label as string]));
  const itemById = new Map(itemRows.map(item => [item.id, item]));

  const { data: redemptions } = await supabase
    .from('event_reservation_item_redemptions')
    .select('id, reservation_item_id, quantity_redeemed, redeemed_at, redeemed_by, voided_at, voided_by, void_reason')
    .in('reservation_item_id', itemRows.length ? itemRows.map(item => item.id) : ['00000000-0000-0000-0000-000000000000'])
    .order('redeemed_at', { ascending: true }) as { data: RedemptionRow[] | null };

  const redemptionRows = redemptions ?? [];
  const adminIds = Array.from(new Set(redemptionRows.flatMap(redemption => [redemption.redeemed_by, redemption.voided_by]).filter((value): value is string => Boolean(value))));
  const { data: auditAdmins } = adminIds.length
    ? await supabase.from('admin_users').select('id, email, first_name, last_name, nickname').in('id', adminIds)
    : { data: [] as { id: string; email: string; first_name?: string | null; last_name?: string | null; nickname?: string | null }[] };
  const adminNameById = new Map((auditAdmins ?? []).map(auditUser => [
    auditUser.id,
    auditUser.nickname || [auditUser.first_name, auditUser.last_name].filter(Boolean).join(' ') || auditUser.email,
  ]));

  const redemptionsByItem = new Map<string, RedemptionRow[]>();
  for (const redemption of redemptionRows) {
    const list = redemptionsByItem.get(redemption.reservation_item_id) ?? [];
    list.push(redemption);
    redemptionsByItem.set(redemption.reservation_item_id, list);
  }

  const nowMs = Date.now();
  const canUndoAny = canAdmin(access, 'scan.undo_any');
  const canUndoOwn = canAdmin(access, 'scan.undo_own');
  const previewItems: ScanPreviewItem[] = itemRows.map(item => {
    const active = (redemptionsByItem.get(item.id) ?? []).filter(redemption => !redemption.voided_at);
    const quantityRedeemed = active.reduce((sum, redemption) => sum + redemption.quantity_redeemed, 0);
    const last = active[active.length - 1] ?? null;
    const lastAgeMs = last ? Math.max(0, nowMs - new Date(last.redeemed_at).getTime()) : Number.POSITIVE_INFINITY;
    const ownRecent = Boolean(canUndoOwn && last?.redeemed_by === adminId && lastAgeMs <= CASHIER_UNDO_WINDOW_MS);

    return {
      reservation_item_id: item.id,
      ticket_type_name: labelById.get(item.ticket_type_id) ?? 'Formule',
      quantity_totale: item.quantity,
      quantity_redenta_netta: quantityRedeemed,
      ultima_redemption: last ? {
        id: last.id,
        quantity: last.quantity_redeemed,
        redeemed_at: last.redeemed_at,
        redeemed_by_name: last.redeemed_by ? adminNameById.get(last.redeemed_by) ?? null : null,
        can_undo: canUndoAny || ownRecent,
        undo_requires_reason: canUndoAny && (last.redeemed_by !== adminId || lastAgeMs > CASHIER_UNDO_WINDOW_MS),
      } : null,
    };
  });

  const history = [...redemptionRows].reverse().map(redemption => {
    const item = itemById.get(redemption.reservation_item_id);
    return {
      id: redemption.id,
      ticket_type_name: item ? labelById.get(item.ticket_type_id) ?? 'Formule' : 'Formule',
      quantity: redemption.quantity_redeemed,
      redeemed_at: redemption.redeemed_at,
      redeemed_by_name: redemption.redeemed_by ? adminNameById.get(redemption.redeemed_by) ?? null : null,
      voided_at: redemption.voided_at,
      voided_by_name: redemption.voided_by ? adminNameById.get(redemption.voided_by) ?? null : null,
      void_reason: redemption.void_reason,
    };
  });

  const checkinWindow = getEventCheckinWindowState(eventRow);
  let blockingReason: string | null = null;
  if (reservation.status === 'cancelled') blockingReason = 'Réservation annulée';
  else if (reservation.status === 'refunded') blockingReason = 'Réservation remboursée';
  else if (reservation.quantity_remaining <= 0) blockingReason = 'Billet entièrement utilisé';
  else if (eventRow.status === 'cancelled') blockingReason = 'Événement annulé';
  else if (eventRow.status === 'draft') blockingReason = 'Événement non publié';
  else if (checkinWindow.blockingReason) blockingReason = checkinWindow.blockingReason;

  return NextResponse.json({
    reservation_id: reservation.id,
    customer_name: reservation.customer_name,
    event_title: eventRow.title ?? null,
    status: reservation.status,
    quantity_total: reservation.quantity_total,
    quantity_remaining: reservation.quantity_remaining,
    redeemable: blockingReason === null,
    blocking_reason: blockingReason,
    checkin_opens_at: checkinWindow.openAt,
    checkin_closes_at: checkinWindow.closeAt,
    items: previewItems,
    history,
  });
}
