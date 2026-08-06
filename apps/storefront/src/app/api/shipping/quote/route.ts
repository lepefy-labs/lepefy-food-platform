/**
 * apps/storefront/src/app/api/shipping/quote/route.ts
 *
 * POST /api/shipping/quote
 * Body: { items: [{product_id, weight_grams, quantity}], to: {country, zip_code} }
 * Response: { available: true, shippingTotal: number, shippingDetails: object }
 *        or { available: false, message: string }
 *
 * Multi-tenant: ogni tenant può avere un provider di spedizione diverso.
 *   packlink    → Packlink PRO API (chiave per-tenant o fallback env)
 *   flat_rate   → tariffa fissa configurata su tenants.flat_rate_amount
 *   pickup_only → nessuna spedizione online disponibile
 *
 * Sopra questo layer provider si applica shipping_country_rules (gratuità
 * sopra soglia / forfait fisso per paese / sconto) — vedi
 * lib/shipping/resolveCountryRule.ts. Zero righe configurate = comportamento
 * identico a prima di questa feature.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { calculateShipping } from '@/lib/shipping/calculateShipping';
import { signQuote } from '@/lib/shipping/quoteToken';
import { resolveCountryRule, applyCountryRule, type ShippingCountryRule } from '@/lib/shipping/resolveCountryRule';

const FROM_ADDRESS = {
  country:  'IT',
  zip_code: '42122',
};

// Applica countryRuleApplied/originalShippingCost/discountApplied/freeShippingApplied
// solo se una regola è stata effettivamente risolta per il paese — altrimenti
// `shippingDetails` resta esattamente quello che era prima di questa feature
// (null per flat_rate, _internal Packlink per packlink).
function mergeCountryRuleDetails(
  base: Record<string, unknown> | null,
  applied: ReturnType<typeof applyCountryRule>,
): Record<string, unknown> | null {
  if (!applied.ruleUsed) return base;
  return {
    ...(base ?? {}),
    countryRuleApplied:   true,
    originalShippingCost: applied.originalCost,
    discountApplied:      applied.discountApplied,
    freeShippingApplied:  applied.freeShippingApplied,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { items, to } = body as {
      items: Array<{ product_id?: string | null; weight_grams: number | null; quantity: number }>;
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

    if (tenant.shipping_provider === 'pickup_only') {
      return NextResponse.json({
        available: false,
        message: 'Ce magasin ne propose pas de livraison. Veuillez choisir le retrait en magasin.',
      });
    }

    // ── Règles commerciales par pays (shipping_country_rules) ────────────────────
    const { data: countryRulesRaw, error: countryRulesError } = await supabase
      .from('shipping_country_rules')
      .select('countries, free_shipping_above, flat_rate_override, discount_type, discount_value')
      .eq('tenant_id', tenant.id)
      .eq('active', true);

    if (countryRulesError) {
      console.error('[shipping/quote] shipping_country_rules query error — tenant_id:', tenant.id, '— error:', countryRulesError);
    }
    const countryRules = (countryRulesRaw ?? []) as ShippingCountryRule[];
    const rule = resolveCountryRule(to.country, countryRules);

    // ── Sous-total panier — calculé côté serveur, jamais fait confiance au client ─
    // Requêté seulement s'il existe au moins une règle à évaluer : les tenants
    // sans configuration n'ajoutent aucune requête supplémentaire.
    let cartSubtotal = 0;
    if (countryRules.length > 0) {
      const productIds = [...new Set(
        items.map((i) => i.product_id).filter((id): id is string => Boolean(id)),
      )];

      if (productIds.length > 0) {
        const { data: dbProducts, error: productsError } = await supabase
          .from('products')
          .select('id, price')
          .eq('tenant_id', tenant.id)
          .in('id', productIds) as { data: Array<{ id: string; price: number }> | null; error: unknown };

        if (productsError) {
          console.error('[shipping/quote] products lookup error — tenant_id:', tenant.id, '— error:', productsError);
        }

        const priceById = new Map((dbProducts ?? []).map((p) => [p.id, p.price]));
        let subtotal = 0;
        for (const item of items) {
          if (!item.product_id) {
            console.warn('[shipping/quote] cart item without product_id — treated as 0 in subtotal');
            continue;
          }
          const price = priceById.get(item.product_id);
          if (price === undefined) {
            console.warn('[shipping/quote] product_id not found for tenant — treated as 0 in subtotal — product_id:', item.product_id, '— tenant_id:', tenant.id);
            continue;
          }
          subtotal += price * item.quantity;
        }
        cartSubtotal = parseFloat(subtotal.toFixed(2));
      }
    }
    console.info('[shipping/quote] country rule resolved:', rule ? JSON.stringify(rule) : 'none', '— cartSubtotal:', cartSubtotal);

    // ── Router per provider ───────────────────────────────────────────────────────

    switch (tenant.shipping_provider) {

      // ── Flat rate ────────────────────────────────────────────────────────────
      case 'flat_rate': {
        if (!tenant.flat_rate_amount) {
          console.error('[shipping/quote] flat_rate provider but flat_rate_amount is null — tenant:', tenant.id);
          return NextResponse.json(
            { available: false, message: 'Tarif de livraison non configuré.' },
            { status: 500 },
          );
        }

        const applied = applyCountryRule(tenant.flat_rate_amount, cartSubtotal, rule);

        return NextResponse.json({
          available: true,
          shippingTotal: applied.finalCost,
          shippingDetails: mergeCountryRuleDetails(null, applied),
          quoteToken: signQuote(applied.finalCost, to.country, to.zip_code, quoteSecret),
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

        // Un forfait fisso è impostato per questo paese: il risultato Packlink
        // verrebbe comunque sovrascritto, quindi saltiamo del tutto la chiamata
        // API (che ha un costo, ed è inutile pagarla per un valore scartato).
        if (rule?.flat_rate_override != null) {
          const applied = applyCountryRule(0, cartSubtotal, rule);
          console.info('[shipping/quote] flat_rate_override — Packlink call skipped — finalCost:', applied.finalCost);

          return NextResponse.json({
            available: true,
            shippingTotal: applied.finalCost,
            shippingDetails: mergeCountryRuleDetails(null, applied),
            quoteToken: signQuote(applied.finalCost, to.country, to.zip_code, quoteSecret),
          });
        }

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

        const applied = applyCountryRule(result.shippingTotal, cartSubtotal, rule);

        return NextResponse.json({
          available: true,
          shippingTotal: applied.finalCost,
          shippingDetails: mergeCountryRuleDetails(result._internal ?? null, applied),
          quoteToken: signQuote(applied.finalCost, to.country, to.zip_code, quoteSecret),
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
