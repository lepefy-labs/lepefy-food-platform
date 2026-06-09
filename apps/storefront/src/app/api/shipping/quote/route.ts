/**
 * apps/storefront/src/app/api/shipping/quote/route.ts
 *
 * POST /api/shipping/quote
 * Body: { items: [{weight_grams, quantity}], to: {country, zip_code} }
 * Response: { available: true, shippingTotal: number, shippingDetails: object }
 *        or { available: false, message: string }
 *
 * Multi-tenant: ogni tenant può avere un provider di spedizione diverso.
 *   packlink    → Packlink PRO API (chiave per-tenant o fallback env)
 *   flat_rate   → tariffa fissa configurata su tenants.flat_rate_amount
 *   pickup_only → nessuna spedizione online disponibile
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { calculateShipping } from '@/lib/shipping/calculateShipping';

const FROM_ADDRESS = {
  country:  'IT',
  zip_code: '42122',
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

    const tenantSlug = process.env.TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(tenantSlug);
    const supabase = createClient();

    // ── Router per provider ───────────────────────────────────────────────────

    switch (tenant.shipping_provider) {

      // ── Pickup only ──────────────────────────────────────────────────────────
      case 'pickup_only':
        return NextResponse.json({
          available: false,
          message: 'Ce magasin ne propose pas de livraison. Veuillez choisir le retrait en magasin.',
        });

      // ── Flat rate ────────────────────────────────────────────────────────────
      case 'flat_rate': {
        if (!tenant.flat_rate_amount) {
          return NextResponse.json(
            { available: false, message: 'Tarif de livraison non configuré.' },
            { status: 500 },
          );
        }
        return NextResponse.json({
          available: true,
          shippingTotal: tenant.flat_rate_amount,
          shippingDetails: null,
        });
      }

      // ── Packlink PRO ─────────────────────────────────────────────────────────
      case 'packlink':
      default: {
        // Chiave API: per-tenant se disponibile, altrimenti fallback env
        const packlinkApiKey = tenant.packlink_api_key ?? process.env.PACKLINK_API_KEY;
        if (!packlinkApiKey) {
          return NextResponse.json(
            { available: false, message: 'Service de livraison non configuré.' },
            { status: 500 },
          );
        }

        const [{ data: surcharge }, { data: vatRates }] = await Promise.all([
          supabase
            .from('packaging_surcharges')
            .select('surcharge_amount, surcharge_mode, max_pack_kg, box_length_cm, box_width_cm, box_height_cm')
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
            packagingSurcharge: surcharge,
            vatRates: vatRates ?? [],
          },
          packlinkApiKey,
        );

        if (!result.available) {
          return NextResponse.json({ available: false, message: result.message });
        }

        return NextResponse.json({
          available: true,
          shippingTotal: result.shippingTotal,
          shippingDetails: result._internal ?? null, // salvato in DB, mai mostrato al cliente
        });
      }
    }

  } catch {
    return NextResponse.json(
      { available: false, message: 'Erreur serveur. Veuillez réessayer.' },
      { status: 500 },
    );
  }
}
