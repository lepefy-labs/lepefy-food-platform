import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { buildExternalPaymentLink } from '@/lib/payments/externalPaymentLink';
import { normalizeDeliveryFeeAmount } from '@/lib/rental/deliveryFee';
import type { TenantPaymentMethod } from '@lepefy/types';

// Fixe/ajuste le supplément de livraison d'une réservation location matériel
// confirmée, en statut 'pending_quote' (aucune zone n'a matché) ou déjà
// 'quoted' (ajustement). Jamais après paiement : un supplément 'paid' n'est
// plus modifiable (contrôle atomique). Génère optionnellement un lien de
// paiement externe que l'admin envoie lui-même au client — aucun envoi automatisé.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as { delivery_fee_amount?: unknown; external_payment_method_id?: unknown } | null;
  const amountCheck = normalizeDeliveryFeeAmount(body?.delivery_fee_amount);
  if (!amountCheck.ok) {
    return NextResponse.json({ error: amountCheck.error, field: 'delivery_fee_amount' }, { status: 400 });
  }
  const amount = amountCheck.amount;
  const externalPaymentMethodId = typeof body?.external_payment_method_id === 'string' ? body.external_payment_method_id : '';

  const supabase = createServiceClient();

  const { data: reservation } = await supabase
    .from('rental_reservations')
    .select('id, tenant_id, fulfillment_type, status, delivery_fee_status')
    .eq('id', params.id)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
  }
  if (reservation.fulfillment_type !== 'delivery') {
    return NextResponse.json({ error: 'Cette réservation n\'est pas en livraison.' }, { status: 400 });
  }
  if (reservation.status !== 'confirmed') {
    return NextResponse.json({ error: 'Réservation annulée ou remboursée : supplément non modifiable.' }, { status: 400 });
  }
  if (reservation.delivery_fee_status === 'paid') {
    return NextResponse.json({ error: 'Supplément déjà payé : le montant ne peut plus changer.' }, { status: 409 });
  }

  const { data: updated, error: updateError } = await supabase
    .from('rental_reservations')
    .update({
      delivery_fee_amount: amount,
      delivery_fee_status: 'quoted',
      delivery_fee_quoted_at: new Date().toISOString(),
    })
    .eq('id', reservation.id)
    .eq('tenant_id', tenant.id)
    .in('delivery_fee_status', ['pending_quote', 'quoted'])
    .select('delivery_fee_status, delivery_fee_amount, delivery_fee_quoted_at')
    .maybeSingle();

  if (updateError) {
    console.error('[admin/evenementiel/reservations/delivery-fee] update error:', updateError, '— reservation:', reservation.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
  if (!updated) {
    // Payé entre la lecture et l'écriture.
    return NextResponse.json({ error: 'Supplément déjà payé : le montant ne peut plus changer.' }, { status: 409 });
  }

  if (!externalPaymentMethodId) {
    return NextResponse.json({ success: true, ...updated });
  }

  const { data: methodRow } = await supabase
    .from('tenant_payment_methods')
    .select('*')
    .eq('id', externalPaymentMethodId)
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .maybeSingle();

  const method = methodRow as TenantPaymentMethod | null;
  const currency = (tenant.currency ?? 'EUR').toUpperCase();
  const link = method ? buildExternalPaymentLink(method, amount, currency) : null;
  if (!method || !link) {
    return NextResponse.json({ success: true, ...updated, linkError: 'Moyen de paiement invalide.' });
  }

  return NextResponse.json({
    success: true,
    ...updated,
    link,
    amount,
    currency,
    label: method.label ?? method.method,
  });
}
