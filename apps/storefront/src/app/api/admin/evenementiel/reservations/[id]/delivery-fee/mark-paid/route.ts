import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

// Marque le supplément de livraison comme payé — confirmation manuelle
// admin après réception du paiement via le lien externe, même principe que
// la confirmation des demandes de paiement (Phase 3). Passage atomique
// quoted → paid ; un second appel (double clic) répond sans rien changer.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data: reservation } = await supabase
    .from('rental_reservations')
    .select('id, tenant_id, delivery_fee_status, delivery_fee_paid_at')
    .eq('id', params.id)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
  }
  if (reservation.delivery_fee_status === 'paid') {
    return NextResponse.json({ success: true, alreadyPaid: true, delivery_fee_paid_at: reservation.delivery_fee_paid_at });
  }
  if (reservation.delivery_fee_status !== 'quoted') {
    return NextResponse.json({ error: 'Fixez d\'abord le montant du supplément.' }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from('rental_reservations')
    .update({ delivery_fee_status: 'paid', delivery_fee_paid_at: new Date().toISOString() })
    .eq('id', reservation.id)
    .eq('tenant_id', tenant.id)
    .eq('delivery_fee_status', 'quoted')
    .select('delivery_fee_paid_at')
    .maybeSingle();

  if (error) {
    console.error('[admin/evenementiel/reservations/delivery-fee/mark-paid] update error:', error, '— reservation:', reservation.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
  if (!updated) {
    // Changé entre la lecture et l'écriture : on relit l'état réel.
    const { data: current } = await supabase
      .from('rental_reservations')
      .select('delivery_fee_status, delivery_fee_paid_at')
      .eq('id', reservation.id)
      .maybeSingle();
    if (current?.delivery_fee_status === 'paid') {
      return NextResponse.json({ success: true, alreadyPaid: true, delivery_fee_paid_at: current.delivery_fee_paid_at });
    }
    return NextResponse.json({ error: 'Le supplément a changé entre-temps. Rechargez la page.' }, { status: 409 });
  }

  return NextResponse.json({ success: true, delivery_fee_paid_at: updated.delivery_fee_paid_at });
}
