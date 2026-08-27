import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requirePermission } from '@/lib/auth/adminRbac';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requirePermission(tenant.id, 'scan.metrics');
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
    .select('id, customer_name, quantity_total, quantity_remaining, status')
    .eq('event_id', eventId)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const confirmed = (reservations ?? []).filter(row => row.status === 'confirmed');
  const rightsTotal = confirmed.reduce((sum, row) => sum + Number(row.quantity_total || 0), 0);
  const rightsRemaining = confirmed.reduce((sum, row) => sum + Number(row.quantity_remaining || 0), 0);
  const rightsRedeemed = Math.max(0, rightsTotal - rightsRemaining);
  const reservationsStarted = confirmed.filter(row => Number(row.quantity_remaining) < Number(row.quantity_total)).length;

  const reservationIds = confirmed.map(row => row.id as string);
  const customerByReservationId = new Map(confirmed.map(row => [row.id as string, (row.customer_name as string | null) ?? 'Réservation']));
  let recentDeliveries: Array<{ id: string; redeemed_at: string; customer_name: string; ticket_type_name: string; quantity: number }> = [];
  let formulaBreakdown: Array<{ ticket_type_id: string; label: string; total: number; served: number; remaining: number }> = [];

  if (reservationIds.length > 0) {
    const { data: items } = await supabase
      .from('event_reservation_items')
      .select('id, reservation_id, ticket_type_id, quantity')
      .in('reservation_id', reservationIds);

    const itemRows = items ?? [];
    const itemIds = itemRows.map(row => row.id as string);
    const ticketTypeIds = [...new Set(itemRows.map(row => row.ticket_type_id as string))];

    const [{ data: ticketTypes }, { data: redemptions }] = await Promise.all([
      ticketTypeIds.length > 0
        ? supabase.from('event_ticket_types').select('id, label, sort_order').in('id', ticketTypeIds)
        : Promise.resolve({ data: [] as Array<{ id: string; label: string; sort_order: number }> }),
      itemIds.length > 0
        ? supabase
            .from('event_reservation_item_redemptions')
            .select('id, reservation_item_id, quantity_redeemed, redeemed_at')
            .in('reservation_item_id', itemIds)
            .is('voided_at', null)
            .order('redeemed_at', { ascending: false })
        : Promise.resolve({ data: [] as Array<{ id: string; reservation_item_id: string; quantity_redeemed: number; redeemed_at: string }> }),
    ]);

    const itemById = new Map(itemRows.map(row => [row.id as string, row]));
    const ticketTypeById = new Map((ticketTypes ?? []).map(row => [row.id as string, row]));
    const servedByTicketType = new Map<string, number>();
    for (const redemption of redemptions ?? []) {
      const item = itemById.get(redemption.reservation_item_id as string);
      if (!item) continue;
      const ticketTypeId = item.ticket_type_id as string;
      servedByTicketType.set(ticketTypeId, (servedByTicketType.get(ticketTypeId) ?? 0) + Number(redemption.quantity_redeemed || 0));
    }

    const totalByTicketType = new Map<string, number>();
    for (const item of itemRows) {
      const ticketTypeId = item.ticket_type_id as string;
      totalByTicketType.set(ticketTypeId, (totalByTicketType.get(ticketTypeId) ?? 0) + Number(item.quantity || 0));
    }

    formulaBreakdown = [...totalByTicketType.entries()]
      .map(([ticketTypeId, total]) => {
        const served = servedByTicketType.get(ticketTypeId) ?? 0;
        const ticketType = ticketTypeById.get(ticketTypeId);
        return {
          ticket_type_id: ticketTypeId,
          label: (ticketType?.label as string | null) ?? 'Formule',
          total,
          served,
          remaining: Math.max(0, total - served),
          sort_order: Number(ticketType?.sort_order ?? 0),
        };
      })
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
      .map(({ sort_order: _sortOrder, ...row }) => row);

    recentDeliveries = (redemptions ?? []).slice(0, 30).map(redemption => {
      const item = itemById.get(redemption.reservation_item_id as string);
      const reservationId = item?.reservation_id as string | undefined;
      const ticketType = item ? ticketTypeById.get(item.ticket_type_id as string) : undefined;
      return {
        id: redemption.id as string,
        redeemed_at: redemption.redeemed_at as string,
        customer_name: reservationId ? customerByReservationId.get(reservationId) ?? 'Réservation' : 'Réservation',
        ticket_type_name: (ticketType?.label as string | null) ?? 'Formule',
        quantity: Number(redemption.quantity_redeemed || 0),
      };
    });
  }

  return NextResponse.json({
    reservations: confirmed.length,
    reservations_started: reservationsStarted,
    rights_total: rightsTotal,
    rights_redeemed: rightsRedeemed,
    rights_remaining: rightsRemaining,
    progress_percent: rightsTotal > 0 ? Math.round((rightsRedeemed / rightsTotal) * 100) : 0,
    formula_breakdown: formulaBreakdown,
    recent_deliveries: recentDeliveries,
    updated_at: new Date().toISOString(),
  });
}
