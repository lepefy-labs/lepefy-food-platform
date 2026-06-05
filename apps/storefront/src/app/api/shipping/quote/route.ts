/**
 * apps/storefront/src/app/api/shipping/quote/route.ts
 *
 * POST /api/shipping/quote
 * Body: { items: [{weight_grams, quantity}], to: {country, zip_code} }
 * Response: { available: true, shippingTotal: number }
 *        or { available: false, message: string }
 *
 * Formula:
 *   num_pacchi      = ceil(peso_totale_g / (max_pack_kg × 1000))
 *   packaging       = surcharge_amount × num_pacchi  (se per_parcel)
 *                   = surcharge_amount               (se per_order)
 *   vat             = packlink_price × vat_rate (per paese, da DB)
 *   shippingTotal   = packlink_price + vat + packaging
 *
 * Il breakdown interno (corriere, IVA, imballo) non viene mai esposto al client.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { calculateShipping } from '@/lib/shipping/calculateShipping';

const FROM_ADDRESS = {
  country:  'IT',
  zip_code: '42122', // Reggio Emilia — sede ChloeFood
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { items, to } = body as {
      items: Array<{ weight_grams: number | null; quantity: number }>;
      to: { country: string; zip_code: string };
    };

    if (!items?.length || !to?.country || !to?.zip_code) {
      return NextResponse.json(
        { available: false, message: 'Paramètres manquants.' },
        { status: 400 },
      );
    }

    const packlinkApiKey = process.env.PACKLINK_API_KEY;
    if (!packlinkApiKey) {
      return NextResponse.json(
        { available: false, message: 'Service de livraison non configuré.' },
        { status: 500 },
      );
    }

    const tenantSlug = process.env.TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(tenantSlug);
    const supabase = createClient();

    // Carica packaging_surcharge e vat_rates in parallelo
    const [{ data: surcharge }, { data: vatRates }] = await Promise.all([
      supabase
        .from('packaging_surcharges')
        .select('surcharge_amount, surcharge_mode, max_pack_kg') // ← nomi colonne aggiornati
        .eq('tenant_id', tenant.id)
        .eq('active', true)
        .single(),
      supabase
        .from('shipping_vat_rates')
        .select('countries, vat_rate')
        .eq('tenant_id', tenant.id)
        .eq('active', true),
    ]);

    if (!surcharge) {
      return NextResponse.json(
        { available: false, message: 'Configuration de livraison manquante.' },
        { status: 500 },
      );
    }

    const result = await calculateShipping(
      {
        cartItems: items,
        from: FROM_ADDRESS,
        to,
        packagingSurcharge: surcharge, // { surcharge_amount, surcharge_mode, max_pack_kg }
        vatRates: vatRates ?? [],
      },
      packlinkApiKey,
    );

    // Esporre al client solo available + shippingTotal — mai _internal
    if (!result.available) {
      return NextResponse.json({ available: false, message: result.message });
    }

    return NextResponse.json({
      available: true,
      shippingTotal: result.shippingTotal,
    });

  } catch {
    return NextResponse.json(
      { available: false, message: 'Erreur serveur. Veuillez réessayer.' },
      { status: 500 },
    );
  }
}
