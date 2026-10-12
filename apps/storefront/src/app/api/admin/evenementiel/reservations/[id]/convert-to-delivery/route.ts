import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { matchDeliveryZone } from '@/lib/rental/matchDeliveryZone';
import { normalizeAddressParts } from '@/lib/address/addressRules';
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

  const body = await req.json().catch(() => null) as {
    street?: unknown; house_number?: unknown; city?: unknown; postal_code?: unknown; country?: unknown;
  } | null;

  // Même contrôle que le checkout location : pays ISO, CP au format du pays.
  const normalized = normalizeAddressParts({
    street: body?.street, houseNumber: body?.house_number, postalCode: body?.postal_code, city: body?.city, country: body?.country,
  });
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error, field: normalized.field, code: 'ADDRESS_INVALID' }, { status: 400 });
  }
  const { street, houseNumber, postalCode, city, country } = normalized.address;

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

  const matchedZone = matchDeliveryZone((zones ?? []) as RentalDeliveryZone[], { country, postal_code: postalCode, city });
  const suggestedFee = matchedZone ? matchedZone.fee_amount : null;
  const deliveryFeeStatus = matchedZone ? 'quoted' : 'pending_quote';

  const { error } = await supabase
    .from('rental_reservations')
    .update({
      fulfillment_type:       'delivery',
      delivery_street:        street,
      delivery_house_number:  houseNumber,
      delivery_city:          city,
      delivery_postal_code:   postalCode,
      delivery_country:       country,
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

  return NextResponse.json({
    success: true,
    suggestedFeeAmount: suggestedFee,
    deliveryFeeStatus,
    zoneLabel: matchedZone?.label ?? null,
    address: { street, house_number: houseNumber, postal_code: postalCode, city, country },
  });
}
