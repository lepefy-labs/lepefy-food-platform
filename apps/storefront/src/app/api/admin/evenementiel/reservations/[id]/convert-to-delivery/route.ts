import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { matchDeliveryZone } from '@/lib/rental/matchDeliveryZone';
import type { RentalDeliveryZone } from '@lepefy/types';

// Convertit une réservation déjà confirmée en 'pickup' vers 'delivery' —
// le client rappelle car il ne peut plus venir chercher son matériel.
// Le paiement original couvre uniquement le matériel : le supplément de
// livraison est TOUJOURS traité à part ensuite via
// PATCH .../delivery-fee (montant pré-suggéré ici par matchDeliveryZone,
// mais jamais facturé automatiquement — aucun second PaymentIntent).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as {
    street?: string; house_number?: string; city?: string; postal_code?: string; country?: string;
  };
  const { street, house_number, city, postal_code, country } = body;

  if (!street?.trim() || !house_number?.trim() || !city?.trim() || !postal_code?.trim() || !country?.trim()) {
    return NextResponse.json({ error: 'Adresse de livraison incomplète.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: reservation } = await supabase
    .from('rental_reservations')
    .select('id, tenant_id, fulfillment_type, status')
    .eq('id', params.id)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
  }
  if (reservation.fulfillment_type !== 'pickup') {
    return NextResponse.json({ error: 'Cette réservation est déjà en livraison.' }, { status: 400 });
  }
  if (reservation.status !== 'confirmed') {
    return NextResponse.json({ error: 'Réservation non confirmée.' }, { status: 400 });
  }

  const { data: zones } = await supabase
    .from('rental_delivery_zones')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('active', true);

  const matchedZone = matchDeliveryZone((zones ?? []) as RentalDeliveryZone[], { country, postal_code, city });
  const suggestedFee = matchedZone ? matchedZone.fee_amount : null;
  const deliveryFeeStatus = matchedZone ? 'quoted' : 'pending_quote';

  const { error } = await supabase
    .from('rental_reservations')
    .update({
      fulfillment_type:       'delivery',
      delivery_street:        street.trim(),
      delivery_house_number:  house_number.trim(),
      delivery_city:          city.trim(),
      delivery_postal_code:   postal_code.trim(),
      delivery_country:       country.trim(),
      delivery_zone_id:       matchedZone?.id ?? null,
      delivery_fee_status:    deliveryFeeStatus,
      delivery_fee_amount:    suggestedFee,
      delivery_fee_quoted_at: matchedZone ? new Date().toISOString() : null,
    })
    .eq('id', reservation.id);

  if (error) {
    console.error('[admin/evenementiel/reservations/convert-to-delivery] update error:', error, '— reservation:', reservation.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }

  return NextResponse.json({ success: true, suggestedFeeAmount: suggestedFee, deliveryFeeStatus });
}
