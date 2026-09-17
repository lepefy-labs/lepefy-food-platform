import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { TenantPaymentMethod } from '@lepefy/types';

// Fixe/ajuste le supplément de livraison d'une réservation location matériel
// en statut 'pending_quote' (aucune zone précise n'a matché au checkout) ou
// déjà 'quoted' (ajustement). Génère optionnellement un lien de paiement
// externe (même logique que /api/rental/checkout-external-link) que l'admin
// copie manuellement pour l'envoyer au client — aucun envoi automatisé.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { delivery_fee_amount?: number; external_payment_method_id?: string };
  const { delivery_fee_amount, external_payment_method_id } = body;

  if (typeof delivery_fee_amount !== 'number' || delivery_fee_amount < 0) {
    return NextResponse.json({ error: 'Montant invalide.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: reservation } = await supabase
    .from('rental_reservations')
    .select('id, tenant_id, fulfillment_type')
    .eq('id', params.id)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
  }
  if (reservation.fulfillment_type !== 'delivery') {
    return NextResponse.json({ error: 'Cette réservation n\'est pas en livraison.' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('rental_reservations')
    .update({
      delivery_fee_amount: delivery_fee_amount,
      delivery_fee_status: 'quoted',
      delivery_fee_quoted_at: new Date().toISOString(),
    })
    .eq('id', reservation.id);

  if (updateError) {
    console.error('[admin/evenementiel/reservations/delivery-fee] update error:', updateError, '— reservation:', reservation.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }

  if (!external_payment_method_id) {
    return NextResponse.json({ success: true });
  }

  const { data: methodRow } = await supabase
    .from('tenant_payment_methods')
    .select('*')
    .eq('id', external_payment_method_id)
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .maybeSingle();

  const method = methodRow as TenantPaymentMethod | null;
  if (!method || method.method === 'bank_transfer' || method.method === 'cash' || !method.extra?.link) {
    return NextResponse.json({ success: true, linkError: 'Moyen de paiement invalide.' });
  }

  const currency = (tenant.currency ?? 'EUR').toUpperCase();
  const link =
    method.method === 'paypal'
      ? `${method.extra.link.replace(/\/+$/, '')}/${delivery_fee_amount.toFixed(2)}${currency}`
      : method.extra.link;

  return NextResponse.json({
    success: true,
    link,
    amount: delivery_fee_amount,
    currency,
    label: method.label ?? method.method,
  });
}
