/**
 * apps/storefront/src/app/api/admin/shipping-simulator/route.ts
 *
 * POST /api/admin/shipping-simulator
 * Body: { weightKg: number; country: string; postalCode: string }
 *
 * Outil admin READ-ONLY : reproduit exactement la logique de
 * /api/shipping/quote (packaging_surcharges → Packlink PRO → IVA →
 * shipping_country_rules) mais expose TOUS les services Packlink retournés
 * par l'API — y compris ceux exclus par le filtre (dropoff/B2B) — avec le
 * motif d'exclusion, pour que l'admin comprenne le calcul sans avoir à
 * demander au développeur.
 *
 * Aucune donnée écrite en DB. Aucun quoteToken signé — ce n'est jamais un
 * devis utilisable en checkout, uniquement une simulation à la demande
 * (bouton "Calculer", jamais automatique/en polling — l'API Packlink a un
 * coût par appel).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import {
  fetchAllPacklinkServices,
  isEligibleService,
  getExclusionReason,
  describePacklinkService,
  resolveVatRate,
  splitIntoParcels,
  calcPackagingSurcharge,
  type PackagingSurcharge,
  type VatRate,
} from '@/lib/shipping/calculateShipping';
import {
  resolveCountryRule,
  applyCountryRule,
  type ShippingCountryRule,
} from '@/lib/shipping/resolveCountryRule';

export const runtime = 'nodejs';

// Même adresse d'expédition que /api/shipping/quote (FROM_ADDRESS) —
// dupliquée ici car non exportée par le module (fichier flux réel non
// modifié, cf. consignes du cycle).
const FROM_ADDRESS = {
  country:  'IT',
  zip_code: '42122',
};

interface SimulatorService {
  id:                      number;
  carrierName:             string;
  serviceName:             string;
  infoLabels:              string[];
  dropoff:                 boolean;
  basePrice:               number;
  taxPrice:                number;
  vatAmount:                number;
  vatRate:                 number;
  vatSource:               'packlink' | 'db';
  packagingSurchargeTotal: number;
  priceWithPackaging:      number;
  eligible:                boolean;
  exclusionReason:         'dropoff' | 'b2b' | null;
  chosen:                  boolean;
}

export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id); // default: tenant_admin + platform_owner — tenant_cashier exclu
  if (denied) return denied;

  const adminId = await getAdminId();

  let body: { weightKg?: unknown; country?: unknown; postalCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ available: false, message: 'Corps de requête invalide.' }, { status: 400 });
  }

  const weightKg = Number(body.weightKg);
  const country  = typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
  const postalCode = typeof body.postalCode === 'string' ? body.postalCode.trim() : '';

  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return NextResponse.json({ available: false, message: 'Poids invalide.' }, { status: 400 });
  }
  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ available: false, message: 'Pays invalide.' }, { status: 400 });
  }
  if (!postalCode) {
    return NextResponse.json({ available: false, message: 'Code postal requis.' }, { status: 400 });
  }

  console.info(
    '[admin/shipping-simulator] request — admin:', adminId, '— tenant:', tenant.id,
    '— weightKg:', weightKg, '— to:', country, postalCode,
  );

  if (tenant.shipping_provider !== 'packlink') {
    return NextResponse.json({
      available: false,
      reason:    'provider_not_packlink',
      message:   `Ce tenant utilise le provider "${tenant.shipping_provider}" — le simulateur Packlink ne s'applique pas.`,
    });
  }

  const packlinkApiKey = tenant.packlink_api_key ?? process.env.PACKLINK_API_KEY;
  if (!packlinkApiKey) {
    console.error('[admin/shipping-simulator] PACKLINK_API_KEY manquant — tenant:', tenant.id);
    return NextResponse.json(
      { available: false, message: 'Clé API Packlink non configurée.' },
      { status: 500 },
    );
  }

  const supabase = createServiceClient();

  const [surchargeResult, vatRatesResult, countryRulesResult] = await Promise.all([
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
    supabase
      .from('shipping_country_rules')
      .select('countries, free_shipping_above, flat_rate_override, discount_type, discount_value')
      .eq('tenant_id', tenant.id)
      .eq('active', true),
  ]);

  const surcharge  = surchargeResult.data as PackagingSurcharge | null;
  const vatRates    = (vatRatesResult.data ?? []) as VatRate[];
  const countryRules = (countryRulesResult.data ?? []) as ShippingCountryRule[];

  if (!surcharge) {
    console.error('[admin/shipping-simulator] packaging_surcharges manquant — tenant:', tenant.id);
    return NextResponse.json(
      { available: false, message: 'Configuration de livraison manquante (packaging_surcharges).' },
      { status: 500 },
    );
  }

  // ── Colis — même formule que le flux réel ────────────────────────────────
  const totalWeightG   = Math.round(weightKg * 1000);
  const parcelWeightsG = splitIntoParcels(totalWeightG, surcharge.max_pack_kg);
  const numParcels     = parcelWeightsG.length;
  const packagingSurchargeTotal = calcPackagingSurcharge(surcharge, numParcels);

  const boxDimensions = {
    length: surcharge.box_length_cm,
    width:  surcharge.box_width_cm,
    height: surcharge.box_height_cm,
  };

  const to = { country, zip_code: postalCode };

  const services = await fetchAllPacklinkServices(
    packlinkApiKey, FROM_ADDRESS, to,
    parcelWeightsG.map((g) => ({
      weight: parseFloat((g / 1000).toFixed(3)),
      width:  boxDimensions.width,
      height: boxDimensions.height,
      length: boxDimensions.length,
    })),
  );

  if (services === null) {
    return NextResponse.json({
      available: false,
      reason:    'packlink_error',
      message:   'Erreur lors de l\'appel à l\'API Packlink. Réessayez.',
    });
  }

  if (services.length === 0) {
    return NextResponse.json({
      available: false,
      reason:    'no_service',
      message:   'Packlink ne retourne aucun service pour cette destination.',
    });
  }

  // ── Détail par service, éligible ou non ──────────────────────────────────
  const eligibleServices = services.filter(isEligibleService);
  const cheapest = eligibleServices.length > 0
    ? eligibleServices.reduce((min, s) => (s.price.base_price < min.price.base_price ? s : min))
    : null;

  const simulatorServices: SimulatorService[] = services.map((s) => {
    const { carrierName, serviceName, infoLabels } = describePacklinkService(s);
    const basePrice = s.price.base_price;
    const taxPrice  = s.price.tax_price ?? 0;

    let vatAmount: number;
    let vatRate: number;
    let vatSource: 'packlink' | 'db';
    if (taxPrice > 0) {
      vatAmount = parseFloat(taxPrice.toFixed(2));
      vatRate   = parseFloat((vatAmount / basePrice).toFixed(4));
      vatSource = 'packlink';
    } else {
      vatRate   = resolveVatRate(country, vatRates);
      vatAmount = parseFloat((basePrice * vatRate).toFixed(2));
      vatSource = 'db';
    }

    const priceWithPackaging = parseFloat((basePrice + vatAmount + packagingSurchargeTotal).toFixed(2));

    return {
      id:           s.id,
      carrierName,
      serviceName,
      infoLabels,
      dropoff:      s.dropoff,
      basePrice,
      taxPrice,
      vatAmount,
      vatRate,
      vatSource,
      packagingSurchargeTotal,
      priceWithPackaging,
      eligible:        isEligibleService(s),
      exclusionReason: getExclusionReason(s),
      chosen:          cheapest !== null && s.id === cheapest.id,
    };
  });

  // ── Règle pays — appliquée sur le service choisi, comme le flux réel ─────
  // Le simulateur ne modélise pas de panier (pas de champ montant dans le
  // formulaire) : cartSubtotal = 0, donc "gratuité au-delà d'un seuil" n'est
  // jamais atteinte ici — le montant du seuil est renvoyé tel quel comme
  // "montant restant à atteindre" pour que Dalice comprenne la règle.
  const rule = resolveCountryRule(country, countryRules);
  const chosenPriceWithPackaging = cheapest
    ? simulatorServices.find((s) => s.id === cheapest.id)!.priceWithPackaging
    : null;

  let countryRulePayload: {
    applied:                     boolean;
    rule:                        ShippingCountryRule | null;
    originalCost:                number | null;
    discountApplied:             number;
    freeShippingApplied:         boolean;
    amountMissingForFreeShipping: number | null;
  };

  let finalCustomerPrice: number | null = null;

  if (chosenPriceWithPackaging === null) {
    countryRulePayload = {
      applied: false, rule: null, originalCost: null,
      discountApplied: 0, freeShippingApplied: false, amountMissingForFreeShipping: null,
    };
  } else {
    const applied = applyCountryRule(chosenPriceWithPackaging, 0, rule);
    finalCustomerPrice = applied.finalCost;
    countryRulePayload = {
      applied:              applied.ruleUsed,
      rule,
      originalCost:         applied.originalCost,
      discountApplied:      applied.discountApplied,
      freeShippingApplied:  applied.freeShippingApplied,
      amountMissingForFreeShipping:
        !applied.freeShippingApplied && rule?.free_shipping_above != null
          ? rule.free_shipping_above
          : null,
    };
  }

  return NextResponse.json({
    available: true,
    input: {
      weightKg, country, postalCode,
      totalWeightG, numParcels, packagingSurchargeTotal,
      boxDimensions,
    },
    services: simulatorServices,
    chosenServiceId: cheapest?.id ?? null,
    countryRule: countryRulePayload,
    finalCustomerPrice,
  });
}
