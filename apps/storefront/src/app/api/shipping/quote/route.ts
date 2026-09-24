/**
 * apps/storefront/src/app/api/shipping/quote/route.ts
 *
 * POST /api/shipping/quote
 * Body: { items: [{product_id, weight_grams, quantity}], to: {country, zip_code} }
 * Response: { available: true, shippingTotal: number, shippingDetails: object, quoteToken, pricingMode? }
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
 *
 * Modalità di pricing (tenants.shipping_pricing_mode, indipendente dal provider):
 *   provider_cost / shadow → flusso sopra, token legacy {t,c,z,e} (invariato);
 *   tariff (V1G)           → versione tariffaria attiva del paese, prezzo e peso
 *                            ricalcolati dal server, disponibilità logistica
 *                            verificata, token V2. Se la tariffa non è
 *                            applicabile: fallback esplicito del tenant
 *                            (shipping_tariff_fallback), mai implicito.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { calculateShipping, resolveVatRate, type VatRate } from '@/lib/shipping/calculateShipping';
import { extraCustomsTerritory, extraCustomsUnavailableMessage } from '@/lib/shipping/extraCustomsTerritories';
import { cartFingerprint, signQuote, signQuoteV2 } from '@/lib/shipping/quoteToken';
import { resolveCountryRule, applyCountryRule, type ShippingCountryRule } from '@/lib/shipping/resolveCountryRule';
import type { FreeShippingInfo } from '@/lib/shipping/freeShippingInfo';
import type { Tenant } from '@lepefy/types';
import { effectivePricingMode, tariffFallback } from '@/lib/shipping/tariff/checkoutShipping';
import {
  MISSING_WEIGHT_MESSAGE, NO_TARIFF_MESSAGE, ZONE_NOT_COVERED_MESSAGE,
  buildTariffShippingDetails, checkTariffAvailability, computeTariffQuote, quantitiesFromItems, tariffUnavailableMessage,
} from '@/lib/shipping/tariff/tariffQuote';

const FROM_ADDRESS = {
  country:  'IT',
  zip_code: '42122',
};

type ServiceClient = ReturnType<typeof createServiceClient>;
type QuoteItem = { product_id?: string | null; weight_grams: number | null; quantity: number };

// Campo informativo per la UI carrello/checkout ("Livraison offerte") — mai
// persistito su orders/checkout_sessions e mai incluso nella firma del quote.
function buildFreeShipping(
  applied: ReturnType<typeof applyCountryRule>,
  rule: ShippingCountryRule | null,
): FreeShippingInfo {
  if (applied.freeShippingApplied && rule?.free_shipping_above != null) {
    return { reason: 'threshold', thresholdAmount: rule.free_shipping_above };
  }
  if (applied.ruleUsed && applied.finalCost === 0) {
    return { reason: 'country_promo' };
  }
  return null;
}

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

type ProviderQuote =
  | { available: true; shippingTotal: number; shippingDetails: Record<string, unknown> | null; freeShipping: FreeShippingInfo }
  | { available: false; message: string; status?: number };

/** Preventivo «costo provider» — flusso storico, invariato. */
async function quoteProviderCost(
  supabase: ServiceClient,
  tenant: Tenant,
  items: QuoteItem[],
  to: { country: string; zip_code: string },
): Promise<ProviderQuote> {
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
        return { available: false, message: 'Tarif de livraison non configuré.', status: 500 };
      }

      const applied = applyCountryRule(tenant.flat_rate_amount, cartSubtotal, rule);
      return {
        available: true,
        shippingTotal: applied.finalCost,
        shippingDetails: mergeCountryRuleDetails(null, applied),
        freeShipping: buildFreeShipping(applied, rule),
      };
    }

    // ── Packlink PRO ─────────────────────────────────────────────────────────
    case 'packlink':
    default: {
      // ── API key ────────────────────────────────────────────────────────────
      const packlinkApiKey = tenant.packlink_api_key ?? process.env.PACKLINK_API_KEY;
      if (!packlinkApiKey) {
        console.error('[shipping/quote] PACKLINK_API_KEY missing — tenant:', tenant.id);
        return { available: false, message: 'Service de livraison non configuré.', status: 500 };
      }
      console.info('[shipping/quote] packlink api key present — source:', tenant.packlink_api_key ? 'tenant DB' : 'env');

      // Un forfait fisso è impostato per questo paese: il risultato Packlink
      // verrebbe comunque sovrascritto, quindi saltiamo del tutto la chiamata
      // API (che ha un costo, ed è inutile pagarla per un valore scartato).
      if (rule?.flat_rate_override != null) {
        const applied = applyCountryRule(0, cartSubtotal, rule);
        console.info('[shipping/quote] flat_rate_override — Packlink call skipped — finalCost:', applied.finalCost);
        return {
          available: true,
          shippingTotal: applied.finalCost,
          shippingDetails: mergeCountryRuleDetails(null, applied),
          freeShipping: buildFreeShipping(applied, rule),
        };
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
        return { available: false, message: 'Configuration de livraison manquante.', status: 500 };
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
        // Zones extra-douanières (Livigno, Campione d'Italia) : Packlink ne
        // propose aucun service. Même indisponibilité, message explicite.
        const territory = result.reason === 'no_service' ? extraCustomsTerritory(to.country, to.zip_code) : null;
        const message = territory
          ? extraCustomsUnavailableMessage(territory, Boolean(tenant.click_collect_enabled))
          : result.message;
        return { available: false, message };
      }

      const applied = applyCountryRule(result.shippingTotal, cartSubtotal, rule);
      return {
        available: true,
        shippingTotal: applied.finalCost,
        shippingDetails: mergeCountryRuleDetails(result._internal ?? null, applied),
        freeShipping: buildFreeShipping(applied, rule),
      };
    }
  }
}

/** Forfait commerciale (V1G): prezzo, disponibilità e token V2 — tutto server-side. */
async function quoteTariff(
  supabase: ServiceClient,
  tenant: Tenant,
  items: QuoteItem[],
  to: { country: string; zip_code: string },
  quoteSecret: string,
): Promise<NextResponse> {
  const clickCollect = Boolean(tenant.click_collect_enabled);
  const quantityByProduct = quantitiesFromItems(items);
  if (!quantityByProduct) {
    return NextResponse.json({ available: false, message: 'Articles invalides. Veuillez actualiser votre panier.' }, { status: 400 });
  }

  // Sous-total serveur (seuil de gratuité) : prix du catalogue, jamais ceux du navigateur.
  const { data: priced, error: pricedError } = await supabase
    .from('products')
    .select('id, price')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .in('id', [...quantityByProduct.keys()]) as { data: Array<{ id: string; price: number }> | null; error: unknown };
  if (pricedError) throw new Error('tariff_subtotal_lookup_failed');
  const priceById = new Map((priced ?? []).map((p) => [p.id, p.price]));
  let subtotalCents = 0;
  for (const [id, qty] of quantityByProduct) subtotalCents += Math.round((priceById.get(id) ?? 0) * 100) * qty;

  const outcome = await computeTariffQuote({
    supabase, tenantId: tenant.id, destination: { country: to.country, postalCode: to.zip_code },
    quantityByProduct, subtotalCents, clickCollectEnabled: clickCollect,
  });

  if (outcome.kind === 'unavailable') {
    console.info('[shipping/quote] tariff unavailable — tenant:', tenant.id, '— reason:', outcome.reason);
    return NextResponse.json({ available: false, message: outcome.message });
  }

  if (outcome.kind === 'fallback') {
    console.info('[shipping/quote] tariff fallback — tenant:', tenant.id, '— reason:', outcome.reason);
    if (tariffFallback(tenant) !== 'provider_cost') {
      return NextResponse.json({
        available: false,
        message: outcome.reason === 'missing_product_weight' ? MISSING_WEIGHT_MESSAGE(clickCollect)
          : outcome.reason === 'zone_not_covered' ? ZONE_NOT_COVERED_MESSAGE(clickCollect)
          : NO_TARIFF_MESSAGE(clickCollect),
      });
    }
    const provider = await quoteProviderCost(supabase, tenant, items, to);
    if (!provider.available) return NextResponse.json({ available: false, message: provider.message }, provider.status ? { status: provider.status } : undefined);
    const details = { ...(provider.shippingDetails ?? {}), pricingMode: 'provider_cost_fallback', tariffFallback: { reason: outcome.reason } };
    return NextResponse.json({
      available: true,
      shippingTotal: provider.shippingTotal,
      shippingDetails: details,
      freeShipping: provider.freeShipping,
      pricingMode: 'provider_cost',
      quoteToken: signQuoteV2({
        ten: tenant.id, t: Math.round(provider.shippingTotal * 100), c: to.country, z: to.zip_code, w: 0,
        h: cartFingerprint(quantityByProduct), m: 'provider_cost', tid: null, tv: null, pq: null, av: 'provider_cost_fallback',
        cr: null, sv: null,
      }, quoteSecret),
    });
  }

  // Disponibilité logistique : jamais déduite de la seule formule tarifaire.
  const [profilesResult, surchargeResult, vatResult] = await Promise.all([
    supabase.from('shipping_packaging_profiles').select('*').eq('tenant_id', tenant.id).eq('active', true),
    supabase.from('packaging_surcharges').select('box_length_cm, box_width_cm, box_height_cm')
      .eq('tenant_id', tenant.id).eq('active', true).maybeSingle(),
    supabase.from('shipping_vat_rates').select('countries, vat_rate').eq('tenant_id', tenant.id).eq('active', true),
  ]);
  const box = surchargeResult.data as { box_length_cm: number; box_width_cm: number; box_height_cm: number } | null;
  const availability = await checkTariffAvailability({
    supabase,
    tenantId: tenant.id,
    shippingProvider: tenant.shipping_provider,
    apiKey: tenant.packlink_api_key ?? process.env.PACKLINK_API_KEY ?? null,
    priced: outcome,
    vatRate: resolveVatRate(outcome.destination.country, (vatResult.data ?? []) as VatRate[]),
    profiles: (profilesResult.data ?? []) as never,
    defaultBox: box ? { length: box.box_length_cm, width: box.box_width_cm, height: box.box_height_cm } : null,
  });
  if (!availability.available) {
    console.info('[shipping/quote] tariff logistics unavailable — tenant:', tenant.id, '— reason:', availability.reason);
    return NextResponse.json({ available: false, message: tariffUnavailableMessage(availability.reason, clickCollect) });
  }

  const snapshot = {
    source: availability.source,
    providerQuoteTtcCents: availability.providerQuoteTtcCents,
    carrier: availability.carrier,
    service: availability.service,
  };
  const commercial = outcome.commercial;
  const freeShipping: FreeShippingInfo = commercial.freeShippingApplied && outcome.rule?.free_shipping_above != null
    ? { reason: 'threshold', thresholdAmount: outcome.rule.free_shipping_above }
    : commercial.ruleApplied && commercial.finalCents === 0 ? { reason: 'country_promo' } : null;

  return NextResponse.json({
    available: true,
    shippingTotal: outcome.finalCents / 100,
    shippingDetails: buildTariffShippingDetails(outcome, snapshot),
    freeShipping,
    pricingMode: 'tariff',
    // Lien vers la grille publique seulement si la page est activée pour le tenant.
    tariffGridUrl: tenant.shipping_public_grid_enabled === true ? '/livraison' : null,
    quoteToken: signQuoteV2({
      ten: tenant.id, t: outcome.finalCents, c: outcome.destination.country, z: outcome.destination.postalCode,
      w: outcome.weightG, h: cartFingerprint(quantityByProduct), m: 'tariff',
      tid: outcome.version.id, tv: outcome.version.version,
      pq: snapshot.providerQuoteTtcCents, av: snapshot.source, cr: snapshot.carrier, sv: snapshot.service,
    }, quoteSecret),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { items, to } = body as {
      items: QuoteItem[];
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

    if (effectivePricingMode(tenant) === 'tariff') {
      return await quoteTariff(supabase, tenant, items, to, quoteSecret);
    }

    const provider = await quoteProviderCost(supabase, tenant, items, to);
    if (!provider.available) {
      return NextResponse.json({ available: false, message: provider.message }, provider.status ? { status: provider.status } : undefined);
    }
    return NextResponse.json({
      available: true,
      shippingTotal: provider.shippingTotal,
      shippingDetails: provider.shippingDetails,
      freeShipping: provider.freeShipping,
      quoteToken: signQuote(provider.shippingTotal, to.country, to.zip_code, quoteSecret),
    });

  } catch (err) {
    console.error('[shipping/quote] unhandled error:', err);
    return NextResponse.json(
      { available: false, message: 'Erreur serveur. Veuillez réessayer.' },
      { status: 500 },
    );
  }
}
