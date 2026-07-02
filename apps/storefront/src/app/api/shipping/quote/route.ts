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
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { calculateShipping } from '@/lib/shipping/calculateShipping';
import { signQuote } from '@/lib/shipping/quoteToken';

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

    // Il segreto serve a firmare il quote: senza, il checkout non può
    // verificare lo shippingTotal e la quotazione non deve essere emessa.
    const quoteSecret = process.env.TRACKING_SECRET;
    if (!quoteSecret) {
      console.error('[shipping/quote] TRACKING_SECRET manquant — impossible de signer le devis');
      return NextResponse.json(
        { available: false, message: 'Service de livraison non configuré.' },
        { status: 500 },
      );
    }

    // ── Tenant ───────────────────────────────────────────────────────────────────
    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    let tenant;
    try {
      tenant = await getTenant(tenantSlug);
    } catch (err) {
      console.error('[shipping/quote] getTenant failed — slug:', tenantSlug, err);
      return NextResponse.json(
        { available: false, message: 'Tenant non trovato.' },
        { status: 500 },
      );
    }
    console.info('[shipping/quote] tenant loaded — id:', tenant.id, 'slug:', tenant.slug, 'provider:', tenant.shipping_provider);

    // Use service client to bypass RLS on internal config tables
    const supabase = createServiceClient();

    // ── Router per provider ───────────────────────────────────────────────────────

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
          console.error('[shipping/quote] flat_rate provider but flat_rate_amount is null — tenant:', tenant.id);
          return NextResponse.json(
            { available: false, message: 'Tarif de livraison non configuré.' },
            { status: 500 },
          );
        }
        return NextResponse.json({
          available: true,
          shippingTotal: tenant.flat_rate_amount,
          shippingDetails: null,
          quoteToken: signQuote(tenant.flat_rate_amount, to.country, to.zip_code, quoteSecret),
        });
      }

      // ── Packlink PRO ─────────────────────────────────────────────────────────
      case 'packlink':
      default: {
        // ── API key ────────────────────────────────────────────────────────────
        const packlinkApiKey = tenant.packlink_api_key ?? process.env.PACKLINK_API_KEY;
        if (!packlinkApiKey) {
          console.error('[shipping/quote] PACKLINK_API_KEY missing — tenant.packlink_api_key:', tenant.packlink_api_key, '— env PACKLINK_API_KEY:', process.env.PACKLINK_API_KEY ?? '(undefined)');
          return NextResponse.json(
            { available: false, message: 'Service de livraison non configuré.' },
            { status: 500 },
          );
        }
        console.info('[shipping/quote] packlink api key present — source:', tenant.packlink_api_key ? 'tenant DB' : 'env');

        // ── DB config queries ─────────────────────────────────────────────────
        const [surchargeResult, vatRatesResult] = await Promise.all([
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

        const { data: surcharge, error: surchargeError } = surchargeResult;
        const { data: vatRates,  error: vatRatesError  } = vatRatesResult;

        if (surchargeError) {
          console.error('[shipping/quote] packaging_surcharges query error — tenant_id:', tenant.id, '— error:', surchargeError);
        }
        if (vatRatesError) {
          console.error('[shipping/quote] shipping_vat_rates query error — tenant_id:', tenant.id, '— error:', vatRatesError);
        }
        console.info('[shipping/quote] surcharge row:', surcharge, '— vatRates count:', vatRates?.length ?? 0);

        if (!surcharge) {
          return NextResponse.json(
            { available: false, message: 'Configuration de livraison manquante.' },
            { status: 500 },
          );
        }

        // ── Calculate ─────────────────────────────────────────────────────────
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

        console.info('[shipping/quote] calculateShipping result:', JSON.stringify(result));

        if (!result.available) {
          return NextResponse.json({ available: false, message: result.message });
        }

        return NextResponse.json({
          available: true,
          shippingTotal: result.shippingTotal,
          shippingDetails: result._internal ?? null,
          quoteToken: signQuote(result.shippingTotal, to.country, to.zip_code, quoteSecret),
        });
      }
    }

  } catch (err) {
    console.error('[shipping/quote] unhandled error:', err);
    return NextResponse.json(
      { available: false, message: 'Erreur serveur. Veuillez réessayer.' },
      { status: 500 },
    );
  }
}
