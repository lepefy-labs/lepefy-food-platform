import { NextRequest, NextResponse } from 'next/server';
import type { ShippingTariffVersionRow, ShippingZoneRow } from '@lepefy/types';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { getCustomerProfile } from '@/lib/customers/getCustomerProfile';
import { isValidPostalCode, normalizePostalCode } from '@/lib/address/addressRules';
import { resolveVatRate, type VatRate } from '@/lib/shipping/calculateShipping';
import { resolveCountryRule, type ShippingCountryRule } from '@/lib/shipping/resolveCountryRule';
import { extraCustomsTerritory } from '@/lib/shipping/extraCustomsTerritories';
import { resolveZoneCodeFromRows } from '@/lib/shipping/intelligence/resolveZone';
import { effectivePricingMode } from '@/lib/shipping/tariff/checkoutShipping';
import { parseTariffVersion } from '@/lib/shipping/tariff/tariffVersion';
import { quantitiesFromItems } from '@/lib/shipping/tariff/tariffQuote';
import { estimateShipping } from '@/lib/shipping/tariff/shippingEstimate';
import { chooseEstimateCountry } from '@/lib/shipping/tariff/estimateCountry';
import { clientIp, createMemoryRateLimiter } from '@/lib/http/memoryRateLimit';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const NO_STORE = { 'Cache-Control': 'no-store' };
// Un panier qui change déclenche une estimation (avec un délai côté client) : 40/min suffit largement.
const allow = createMemoryRateLimiter({ limit: 40, windowMs: 60_000 });

const none = (status = 200) => NextResponse.json({ estimate: null }, { status, headers: NO_STORE });

/**
 * POST /api/shipping/estimate — estimation du forfait pour le panier.
 * Body : { items: [{ productId, quantity }], address?: { country, postalCode }, chosenCountry? }
 *
 * Même moteur, mêmes poids (base, jamais le navigateur), mêmes règles pays que
 * le devis du checkout ; le prix payé vient toujours du devis signé, jamais
 * d'ici. Réponse minimale : pays, prix estimé, marge arrondie, supplément de
 * zone possible, pays servis. Jamais la grille, les coûts ni les bornes.
 */
export async function POST(req: NextRequest) {
  if (!allow(clientIp(req.headers))) return NextResponse.json({ estimate: null, error: 'rate_limited' }, { status: 429, headers: NO_STORE });
  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    if (effectivePricingMode(tenant) !== 'tariff') return none();

    const body = await req.json().catch(() => null) as {
      items?: Array<{ productId?: unknown; quantity?: unknown }>;
      address?: { country?: unknown; postalCode?: unknown } | null;
      chosenCountry?: unknown;
    } | null;
    const quantities = Array.isArray(body?.items) && body.items.length <= 60
      ? quantitiesFromItems(body.items as Array<{ productId?: string | null; quantity: unknown }>)
      : null;
    if (!quantities) return none(400);

    const db = createServiceClient();
    const [versionsResult, productsResult] = await Promise.all([
      db.from('shipping_tariff_versions').select('*').eq('tenant_id', tenant.id).eq('status', 'active'),
      db.from('products').select('id, price, weight_grams').eq('tenant_id', tenant.id).eq('active', true).in('id', [...quantities.keys()]),
    ]);
    if (versionsResult.error || productsResult.error) return none(503);
    const versions = (versionsResult.data ?? []) as ShippingTariffVersionRow[];
    if (!versions.length) return none();

    // Poids et sous-total serveur : un produit absent, inactif ou sans poids = pas d'estimation (le checkout tranchera).
    const products = new Map(((productsResult.data ?? []) as Array<{ id: string; price: number; weight_grams: number | null }>).map((p) => [p.id, p]));
    let weightG = 0;
    let subtotalCents = 0;
    for (const [id, quantity] of quantities) {
      const product = products.get(id);
      if (!product || typeof product.weight_grams !== 'number' || !(product.weight_grams > 0)) return none();
      weightG += Math.round(product.weight_grams) * quantity;
      subtotalCents += Math.round(Number(product.price) * 100) * quantity;
    }

    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    const address = body?.address && text(body.address.country)
      ? { country: text(body.address.country)!, postalCode: text(body.address.postalCode) }
      : null;
    const sessionCustomer = address ? null : await getSessionCustomer(tenant.id).catch(() => null);
    const profile = sessionCustomer ? await getCustomerProfile(sessionCustomer.id, tenant.id).catch(() => null) : null;
    const activeCountries = versions.map((v) => v.country.toUpperCase());
    const chosen = chooseEstimateCountry({
      activeCountries,
      address,
      chosenCountry: text(body?.chosenCountry),
      account: profile?.defaultAddress ? { country: profile.defaultAddress.country, postalCode: profile.defaultAddress.postalCode } : null,
      ipCountry: req.headers.get('x-vercel-ip-country'),
      defaultCountry: tenant.country,
    });
    if (!chosen) return none();

    const version = versions.find((v) => v.country.toUpperCase() === chosen.country)!;
    const parsed = parseTariffVersion(version);
    if (!parsed.ok) return none();

    const [zonesResult, rulesResult, vatResult] = await Promise.all([
      db.from('shipping_zones').select('*').eq('tenant_id', tenant.id).eq('country', chosen.country).eq('active', true),
      db.from('shipping_country_rules').select('countries, free_shipping_above, flat_rate_override, discount_type, discount_value')
        .eq('tenant_id', tenant.id).eq('active', true),
      db.from('shipping_vat_rates').select('countries, vat_rate').eq('tenant_id', tenant.id).eq('active', true),
    ]);
    if (zonesResult.error || rulesResult.error || vatResult.error) return none(503);

    // CP connu et valide : zone exacte (même résolution que le devis). Sinon : prix continental + marge prudente.
    let zoneCode: string | null | undefined;
    const postalCode = chosen.postalCode ? normalizePostalCode(chosen.country, chosen.postalCode) : null;
    if (postalCode && isValidPostalCode(chosen.country, postalCode)) {
      if (extraCustomsTerritory(chosen.country, postalCode)) return none();
      zoneCode = resolveZoneCodeFromRows((zonesResult.data ?? []) as ShippingZoneRow[], chosen.country, postalCode);
      if (!zoneCode) return none();
    }

    const estimate = estimateShipping({
      tariff: parsed.tariff,
      weightG,
      zoneCode,
      vatRate: resolveVatRate(chosen.country, (vatResult.data ?? []) as VatRate[]),
      subtotalCents,
      rule: resolveCountryRule(chosen.country, (rulesResult.data ?? []) as ShippingCountryRule[]),
    });
    if (!estimate) return none();
    return NextResponse.json({ estimate: { ...estimate, source: chosen.source, countries: activeCountries } }, { headers: NO_STORE });
  } catch {
    // Information de confort : le panier et le checkout n'en dépendent jamais.
    return none(503);
  }
}
