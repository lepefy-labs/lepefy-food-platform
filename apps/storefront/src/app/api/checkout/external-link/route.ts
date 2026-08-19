import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { verifyQuote } from '@/lib/shipping/quoteToken';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { saveCheckoutProfile } from '@/lib/customers/saveCheckoutProfile';
import { resolveCheckoutAmbassadorDiscount } from '@/lib/ambassador/resolveCheckoutAmbassadorDiscount';
import { resolveCheckoutConsentState } from '@/lib/legal/resolveCheckoutConsentState';
import { generateCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import type { TenantPaymentMethod } from '@lepefy/types';

// Phase 1 — paiement via lien externe (PayPal/Revolut/autre), boutique
// uniquement. Même règle absolue que Stripe : aucune commande n'est créée au
// clic, seulement une checkout_session (payment_method='external_link') —
// voir createOrderFromCheckoutSession, appelée uniquement par la confirmation
// manuelle admin (Task 4), jamais depuis cette route.
//
// Miroir du branchement Stripe de /api/checkout (mêmes contrôles : produits,
// stock, devis de livraison signé, remise ambassadeur) — route séparée
// plutôt qu'une branche de plus dans /api/checkout car le format de sortie
// diffère complètement (pas de PaymentIntent, un lien + snapshot moyen de
// paiement à construire).

const MAX_QUANTITY_PER_ITEM = 999;

interface CartItemPayload {
  productId:    string;
  name:         string;
  price:        number;
  quantity:     number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
}

interface ShippingAddress {
  full_name:   string;
  line1:       string;
  city:        string;
  postal_code: string;
  country:     string;
}

interface CheckoutBody {
  items:                  CartItemPayload[];
  shippingAddress:        ShippingAddress | null;
  fulfillmentType:        'delivery' | 'pickup';
  email:                  string;
  phone?:                 string | null;
  fullName?:              string | null;
  shippingDetails:        Record<string, unknown> | null;
  quoteToken?:            string | null;
  externalPaymentMethodId: string;
  termsAccepted?:  boolean;
  marketingOptIn?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body: CheckoutBody = await req.json();
    const {
      items: rawItems, shippingAddress, fulfillmentType, email,
      phone, fullName, shippingDetails, quoteToken, externalPaymentMethodId,
      termsAccepted, marketingOptIn,
    } = body;

    if (!rawItems?.length || !email || !externalPaymentMethodId) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant     = await getTenant(tenantSlug);
    const supabase   = createServiceClient();

    // ── Résolution du moyen de paiement — TOUJOURS depuis la DB, jamais
    // depuis un champ envoyé par le client (label, lien, type). ────────────
    const { data: methodRow } = await supabase
      .from('tenant_payment_methods')
      .select('*')
      .eq('id', externalPaymentMethodId)
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .maybeSingle();

    const method = methodRow as TenantPaymentMethod | null;

    if (!method || method.method === 'bank_transfer' || method.method === 'cash' || !method.extra?.link) {
      return NextResponse.json({ error: 'Moyen de paiement invalide.' }, { status: 400 });
    }

    const sessionCustomer = await getSessionCustomer(tenant.id);

    // ── Consentement (Ciclo 5) — même garde que /api/checkout : la décision
    // "faut-il montrer" est recalculée ici, jamais fournie par le client.
    const consentState = await resolveCheckoutConsentState(tenant.id, sessionCustomer?.id ?? null);
    if (consentState.showTermsCheckbox && termsAccepted !== true) {
      return NextResponse.json(
        { error: 'Merci d\'accepter les Conditions Générales de Vente pour continuer.' },
        { status: 400 },
      );
    }

    // ── Ricalcolo prezzi server-side ─────────────────────────────────────────
    for (const i of rawItems) {
      if (
        !i.productId ||
        !Number.isInteger(i.quantity) ||
        i.quantity < 1 ||
        i.quantity > MAX_QUANTITY_PER_ITEM
      ) {
        return NextResponse.json({ error: 'Article invalide.' }, { status: 400 });
      }
    }

    const productIds = [...new Set(rawItems.map((i) => i.productId))];
    const { data: dbProducts, error: productsError } = await supabase
      .from('products')
      .select('id, name, price, storage_type, stock')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .in('id', productIds) as {
        data: Array<{
          id:           string;
          name:         string;
          price:        number;
          storage_type: 'dry' | 'fresh' | 'frozen' | null;
          stock:        number;
        }> | null;
        error: unknown;
      };

    if (productsError || !dbProducts) {
      console.error('[checkout/external-link] products lookup error:', productsError);
      return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
    }

    const productById = new Map(dbProducts.map((p) => [p.id, p]));
    if (productIds.some((id) => !productById.has(id))) {
      return NextResponse.json(
        { error: 'Certains articles de votre panier ne sont plus disponibles.' },
        { status: 400 },
      );
    }

    // Contrôle stock informatif ("fail fast") — aucun décrément ici : le
    // stock n'est réservé qu'à la confirmation manuelle du paiement.
    const quantityByProduct = new Map<string, number>();
    for (const i of rawItems) {
      quantityByProduct.set(i.productId, (quantityByProduct.get(i.productId) ?? 0) + i.quantity);
    }

    const insufficientStock: string[] = [];
    for (const [productId, requestedQty] of quantityByProduct) {
      const p = productById.get(productId)!;
      if (p.stock < requestedQty) insufficientStock.push(p.name);
    }
    if (insufficientStock.length > 0) {
      return NextResponse.json(
        { error: `Stock insuffisant pour : ${insufficientStock.join(', ')}.` },
        { status: 400 },
      );
    }

    const items: CartItemPayload[] = rawItems.map((i) => {
      const p = productById.get(i.productId)!;
      return {
        productId:    p.id,
        name:         p.name,
        price:        p.price,
        quantity:     i.quantity,
        storage_type: p.storage_type ?? 'dry',
      };
    });

    // ── Verifica costo spedizione ────────────────────────────────────────────
    let shippingTotal = 0;

    if (fulfillmentType === 'delivery') {
      const quoteSecret = process.env.TRACKING_SECRET;
      if (!quoteSecret) {
        console.error('[checkout/external-link] TRACKING_SECRET manquant');
        return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
      }

      if (!quoteToken || !shippingAddress) {
        return NextResponse.json(
          { error: 'Frais de livraison non calculés. Veuillez repasser par le panier.' },
          { status: 400 },
        );
      }

      const verification = verifyQuote(quoteToken, quoteSecret);
      if (!verification.valid) {
        console.warn('[checkout/external-link] quote token rejected — reason:', verification.reason);
        return NextResponse.json(
          { error: 'Le devis de livraison a expiré. Veuillez repasser par le panier.' },
          { status: 400 },
        );
      }

      const quote = verification.payload;
      if (quote.c !== shippingAddress.country || quote.z !== shippingAddress.postal_code) {
        return NextResponse.json(
          { error: 'L\'adresse de livraison a changé. Veuillez recalculer les frais depuis le panier.' },
          { status: 400 },
        );
      }

      shippingTotal = quote.t;
    }

    const subtotal = parseFloat(
      items.reduce((sum, i) => sum + i.price * i.quantity, 0).toFixed(2),
    );

    const ambassadorDiscount = await resolveCheckoutAmbassadorDiscount({
      tenant: {
        id: tenant.id,
        ambassador_min_purchase_amount: tenant.ambassador_min_purchase_amount,
        ambassador_commission_mode: tenant.ambassador_commission_mode,
        ambassador_split_pool_amount: tenant.ambassador_split_pool_amount,
        ambassador_split_pool_ambassador_percent: tenant.ambassador_split_pool_ambassador_percent,
        ambassador_first_order_discount_type: tenant.ambassador_first_order_discount_type,
        ambassador_first_order_discount_value: tenant.ambassador_first_order_discount_value,
      },
      customerId: sessionCustomer?.id ?? null,
      subtotal,
    });

    const total = parseFloat((subtotal + shippingTotal - ambassadorDiscount).toFixed(2));

    // ── Construction du lien (Décision 4) ────────────────────────────────────
    // paypal.me n'accepte qu'un montant en suffixe d'URL — aucun autre
    // paramètre de causale n'existe pour ce format. Pour tout autre type
    // (revolut/satispay/other), le lien reste tel quel : le montant est
    // affiché à l'écran avec invitation à le saisir manuellement (page
    // /checkout/en-attente).
    const currency = (tenant.currency ?? 'EUR').toUpperCase();
    const finalLink =
      method.method === 'paypal'
        ? `${method.extra.link.replace(/\/+$/, '')}/${total.toFixed(2)}${currency}`
        : method.extra.link;

    const { data: session, error: sessionError } = await supabase
      .from('checkout_sessions')
      .insert({
        tenant_id:        tenant.id,
        customer_id:      sessionCustomer?.id ?? null,
        email,
        full_name:        fullName ?? null,
        phone:            phone ?? null,
        fulfillment_type: fulfillmentType,
        shipping_address: shippingAddress ?? null,
        shipping_details: shippingDetails ?? null,
        shipping_total:   shippingTotal,
        ambassador_discount_amount: ambassadorDiscount,
        items,
        payment_method:          'external_link',
        external_payment_type:   method.method,
        external_payment_label:  method.label ?? method.method,
        external_payment_link:   finalLink,
        consent_terms_accepted:    consentState.showTermsCheckbox ? true : null,
        consent_terms_doc_version: consentState.showTermsCheckbox ? consentState.termsDocVersion : null,
        consent_marketing_accepted: consentState.showMarketingCheckbox ? marketingOptIn === true : null,
      })
      .select('id')
      .single();

    if (sessionError || !session) {
      console.error('[checkout/external-link] checkout_sessions insert error:', sessionError);
      return NextResponse.json(
        { error: 'Erreur lors de la création de la demande de paiement.' },
        { status: 500 },
      );
    }

    console.info('[checkout/external-link] checkout_session created — id:', session.id, '— tenant:', tenant.id,
      '— method:', method.method);

    if (sessionCustomer) {
      await saveCheckoutProfile({
        customerId:      sessionCustomer.id,
        tenantId:        tenant.id,
        fullName,
        phone,
        shippingAddress: fulfillmentType === 'pickup' ? null : shippingAddress,
      });
    }

    // Autorise le client (guest ou connecté) à revenir sur cette session plus
    // tard depuis /checkout/en-attente (modification/annulation avant
    // confirmation) sans exiger de login — même principe que le lien de suivi
    // commande, cf. checkoutSessionAccessToken.ts.
    const accessToken = generateCheckoutSessionAccessToken(session.id, email);

    return NextResponse.json({
      sessionId: session.id,
      link:      finalLink,
      amount:    total,
      currency,
      isPaypal:  method.method === 'paypal',
      label:     method.label ?? method.method,
      accessToken,
    });
  } catch (err) {
    console.error('[checkout/external-link] unhandled error:', err);
    return NextResponse.json(
      { error: 'Erreur serveur. Veuillez réessayer.' },
      { status: 500 },
    );
  }
}
