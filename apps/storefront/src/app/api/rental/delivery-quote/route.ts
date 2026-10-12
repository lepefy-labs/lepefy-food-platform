/**
 * POST /api/rental/delivery-quote
 * Body: { service_offering_id: string, country: string, postal_code: string, city: string }
 * Response: { available: boolean; feeAmount: number | null; zoneMatched: boolean; reason?: 'country_not_allowed' | 'delivery_disabled' }
 *
 * Devis d'affichage uniquement — l'aperçu du supplément montré au client
 * pendant qu'il remplit son adresse. Le montant réellement facturé est
 * TOUJOURS recalculé côté serveur dans /api/rental/checkout et
 * /api/rental/checkout-external-link à partir du même matchDeliveryZone() —
 * jamais fait confiance à une valeur envoyée par le client.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { isCountryAllowedForDelivery, matchDeliveryZone } from '@/lib/rental/matchDeliveryZone';
import { normalizePostalCode } from '@/lib/address/addressRules';
import type { RentalDeliveryZone } from '@lepefy/types';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const raw = body as { country?: string; postal_code?: string; city?: string };
    if (!raw.country?.trim() || !raw.postal_code?.trim() || !raw.city?.trim()) {
      return NextResponse.json({ available: false, feeAmount: null, zoneMatched: false }, { status: 400 });
    }
    // Même normalisation que le paiement : l'aperçu montre le supplément que
    // le checkout calculera réellement.
    const country = raw.country.trim().toUpperCase();
    const postal_code = normalizePostalCode(country, raw.postal_code);
    const city = raw.city.trim().replace(/\s+/g, ' ');

    const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(slug);

    if (!isCountryAllowedForDelivery(tenant, country)) {
      return NextResponse.json({
        available: false,
        feeAmount: null,
        zoneMatched: false,
        reason: tenant.rental_delivery_enabled ? 'country_not_allowed' : 'delivery_disabled',
      });
    }

    const supabase = createServiceClient();
    const { data: zones, error } = await supabase
      .from('rental_delivery_zones')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('active', true);

    if (error) {
      console.error('[rental/delivery-quote] rental_delivery_zones query error — tenant_id:', tenant.id, '— error:', error);
    }

    const matched = matchDeliveryZone((zones ?? []) as RentalDeliveryZone[], { country, postal_code, city });

    return NextResponse.json({
      available: true,
      feeAmount: matched ? matched.fee_amount : null,
      zoneMatched: Boolean(matched),
    });
  } catch (err) {
    console.error('[rental/delivery-quote] unhandled error:', err);
    return NextResponse.json({ available: false, feeAmount: null, zoneMatched: false }, { status: 500 });
  }
}
