import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { extractQrToken } from '@/lib/events/ticketUrl';

interface ItemRow {
  id: string;
  ticket_type_id: string;
  quantity: number;
}

interface RedemptionRow {
  id: string;
  reservation_item_id: string;
  quantity_redeemed: number;
  redeemed_at: string;
  voided_at: string | null;
  admin_users: { email: string } | null;
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
  } | null;
}

// Lecture seule : renvoie la réservation + l'état de redemption par formule,
// consommé par le step "preview" de ScanClient (avant confirmation du delta).
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id, ['tenant_admin', 'tenant_cashier']);
  if (denied) return denied;

  if (!tenant.events_enabled) {
    return NextResponse.json({ error: 'Module événementiel non activé.' }, { status: 400 });
  }

  const qrToken = extractQrToken(decodeURIComponent(params.token));
  if (!qrToken) {
    return NextResponse.json({ error: 'Code QR invalide.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: reservation } = await supabase
    .from('event_reservations')
    .select('id, tenant_id, event_id, customer_name, quantity_total, quantity_remaining, status')
    .eq('qr_token', qrToken)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Code QR invalide pour cette boutique.' }, { status: 404 });
  }

  const { data: eventRow } = await supabase
    .from('events')
    .select('title')
    .eq('id', reservation.event_id)
    .maybeSingle();

  const { data: items } = await supabase
    .from('event_reservation_items')
    .select('id, ticket_type_id, quantity')
    .eq('reservation_id', reservation.id) as { data: ItemRow[] | null };

  const itemRows = items ?? [];

  const { data: ticketTypes } = await supabase
    .from('event_ticket_types')
    .select('id, label')
    .in('id', itemRows.map(i => i.ticket_type_id).length ? itemRows.map(i => i.ticket_type_id) : ['00000000-0000-0000-0000-000000000000']);

  const labelById = new Map((ticketTypes ?? []).map(t => [t.id, t.label as string]));

  const { data: redemptions } = await supabase
    .from('event_reservation_item_redemptions')
    .select('id, reservation_item_id, quantity_redeemed, redeemed_at, voided_at, admin_users(email)')
    .in('reservation_item_id', itemRows.map(i => i.id).length ? itemRows.map(i => i.id) : ['00000000-0000-0000-0000-000000000000'])
    .order('redeemed_at', { ascending: true }) as { data: RedemptionRow[] | null };

  const redemptionsByItem = new Map<string, RedemptionRow[]>();
  for (const r of redemptions ?? []) {
    const list = redemptionsByItem.get(r.reservation_item_id) ?? [];
    list.push(r);
    redemptionsByItem.set(r.reservation_item_id, list);
  }

  const previewItems: ScanPreviewItem[] = itemRows.map(item => {
    const itemRedemptions = redemptionsByItem.get(item.id) ?? [];
    const active = itemRedemptions.filter(r => !r.voided_at);
    const quantityRedentaNetta = active.reduce((sum, r) => sum + r.quantity_redeemed, 0);
    const last = active[active.length - 1] ?? null;

    return {
      reservation_item_id: item.id,
      ticket_type_name: labelById.get(item.ticket_type_id) ?? 'Formule',
      quantity_totale: item.quantity,
      quantity_redenta_netta: quantityRedentaNetta,
      ultima_redemption: last
        ? {
            id: last.id,
            quantity: last.quantity_redeemed,
            redeemed_at: last.redeemed_at,
            redeemed_by_name: last.admin_users?.email ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({
    reservation_id: reservation.id,
    customer_name:  reservation.customer_name,
    event_title:    eventRow?.title ?? null,
    status:         reservation.status,
    quantity_total:     reservation.quantity_total,
    quantity_remaining: reservation.quantity_remaining,
    items: previewItems,
  });
}
