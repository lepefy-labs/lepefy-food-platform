import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

// Marque le supplément de livraison comme payé — confirmation manuelle
// admin après réception du paiement via le lien externe, même principe que
// la confirmation des demandes de paiement (Phase 3).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data: reservation } = await supabase
    .from('rental_reservations')
    .select('id, tenant_id, delivery_fee_status')
    .eq('id', params.id)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
  }
  if (reservation.delivery_fee_status !== 'quoted') {
    return NextResponse.json({ error: 'Aucun supplément quoté pour cette réservation.' }, { status: 400 });
  }

  const { error } = await supabase
    .from('rental_reservations')
    .update({ delivery_fee_status: 'paid', delivery_fee_paid_at: new Date().toISOString() })
    .eq('id', reservation.id);

  if (error) {
    console.error('[admin/evenementiel/reservations/delivery-fee/mark-paid] update error:', error, '— reservation:', reservation.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
