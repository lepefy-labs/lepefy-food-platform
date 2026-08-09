import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { extractQrToken } from '@/lib/events/ticketUrl';

interface RedeemRpcRow {
  success:   boolean;
  remaining: number;
  reason:    string;
}

// Redemption QR le jour de l'événement — accessible à tenant_admin ET
// tenant_cashier (même rôle que le scan fidélité, cf. requireAdmin.ts).
export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id, ['tenant_admin', 'tenant_cashier']);
  if (denied) return denied;

  if (!tenant.events_enabled) {
    return NextResponse.json({ error: 'Module événementiel non activé.' }, { status: 400 });
  }

  const body = await req.json() as { qr_token?: string; quantity?: number };
  // Normalisation défensive : le client envoie déjà le token extrait, mais on
  // tolère aussi l'URL complète du billet (nouveau contenu du QR) ici.
  const qrToken  = extractQrToken(body.qr_token ?? '');
  const quantity = Number(body.quantity);

  if (!qrToken || !Number.isInteger(quantity) || quantity < 1) {
    return NextResponse.json({ error: 'Code QR et quantité valides requis.' }, { status: 400 });
  }

  const adminId = await getAdminId();
  if (!adminId) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Vérifie que la réservation appartient bien à ce tenant AVANT la RPC —
  // évite qu'un admin d'un autre tenant valide un QR qui ne le concerne pas.
  const { data: reservation } = await supabase
    .from('event_reservations')
    .select('id, tenant_id, event_id, customer_name')
    .eq('qr_token', qrToken)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Code QR invalide pour cette boutique.' }, { status: 404 });
  }

  const { data: eventRow } = await supabase
    .from('events')
    .select('title, date_start')
    .eq('id', reservation.event_id)
    .maybeSingle();

  const { data, error } = await supabase
    .rpc('redeem_event_reservation', { p_qr_token: qrToken, p_quantity: quantity, p_admin_id: adminId })
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data as RedeemRpcRow;

  if (!row.success) {
    return NextResponse.json({ error: row.reason, remaining: row.remaining }, { status: 409 });
  }

  return NextResponse.json({
    success:       true,
    remaining:     row.remaining,
    customerName:  reservation.customer_name,
    eventTitle:    eventRow?.title ?? null,
  });
}
