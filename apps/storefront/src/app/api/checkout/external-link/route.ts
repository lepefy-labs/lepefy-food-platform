import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { verifyQuote } from '@/lib/shipping/quoteToken';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { saveCheckoutProfile } from '@/lib/customers/saveCheckoutProfile';
import { resolveCheckoutAmbassadorDiscount } from '@/lib/ambassador/resolveCheckoutAmbassadorDiscount';
import { resolveCheckoutConsentState } from '@/lib/legal/resolveCheckoutConsentState';
import { generateCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import { upsertActiveCheckoutSession } from '@/lib/checkout/activeCheckoutSession';
import { notifyExternalPaymentAwaitingVerification } from '@/lib/notifications/notifyExternalPaymentAwaitingVerification';
import { recordNalaCheckoutStarted } from '@/lib/ai/nalaConversionAttribution';
import type { TenantPaymentMethod } from '@lepefy/types';

const MAX_QUANTITY_PER_ITEM = 999;

interface CartItemPayload {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
}

interface ShippingAddress {
  full_name: string;
  line1: string;
  city: string;
  postal_code: string;
  country: string;
}

interface CheckoutBody {
  items: CartItemPayload[];
  shippingAddress: ShippingAddress | null;
  fulfillmentType: 'delivery' | 'pickup';
  email: string;
  phone?: string | null;
  fullName?: string | null;
  shippingDetails: Record<string, unknown> | null;
  quoteToken?: string | null;
  externalPaymentMethodId: string;
  termsAccepted?: boolean;
  marketingOptIn?: boolean;
  nalaAttributions?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const body: CheckoutBody = await req.json();
    const {
      items: rawItems, shippingAddress, fulfillmentType, email,
      phone, fullName, shippingDetails, quoteToken, externalPaymentMethodId,
      termsAccepted, marketingOptIn, nalaAttributions,
    } = body;

    if (!rawItems?.length || !email || !externalPaymentMethodId) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(tenantSlug);
    const supabase = createServiceClient();

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
    const consentState = await resolveCheckoutConsentState(tenant.id, sessionCustomer?.id ?? null);
    if (consentState.showTermsCheckbox && termsAccepted !== true) {
      return NextResponse.json(
        { error: 'Merci d\'accepter les Conditions Générales de Vente pour continuer.' },
        { status: 400 },
      );
    }

    for (const item of rawItems) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_ITEM) {
        return NextResponse.json({ error: 'Article invalide.' }, { status: 400 });
      }
    }

    const productIds = [...new Set(rawItems.map((item) => item.productId))];
    const { data: dbProducts, error: productsError } = await supabase
      .from('products')
      .select('id, name, price, storage_type, stock')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .in('id', productIds) as {
        data: Array<{ id: string; name: string; price: number; storage_type: 'dry' | 'fresh' | 'frozen' | null; stock: number }> | null;
        error: unknown;
      };

    if (productsError || !dbProducts) {
      console.error('[checkout/external-link] products lookup error:', productsError);
      return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
    }

    const productById = new Map(dbProducts.map((product) => [product.id, product]));
    if (productIds.some((id) => !productById.has(id))) {
      return NextResponse.json({ error: 'Certains articles de votre panier ne sont plus disponibles.' }, { status: 400 });
    }

    const quantityByProduct = new Map<string, number>();
    for (const item of rawItems) {
      quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? 0) + item.quantity);
    }
    const insufficientStock: string[] = [];
    for (const [productId, requestedQty] of quantityByProduct) {
      const product = productById.get(productId)!;
      if (product.stock < requestedQty) insufficientStock.push(product.name);
    }
    if (insufficientStock.length > 0) {
      return NextResponse.json({ error: `Stock insuffisant pour : ${insufficientStock.join(', ')}.` }, { status: 400 });
    }

    const items: CartItemPayload[] = rawItems.map((item) => {
      const product = productById.get(item.productId)!;
      return {
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        storage_type: product.storage_type ?? 'dry',
      };
    });

    let shippingTotal = 0;
    if (fulfillmentType === 'delivery') {
      const quoteSecret = process.env.TRACKING_SECRET;
      if (!quoteSecret) return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
      if (!quoteToken || !shippingAddress) {
        return NextResponse.json({ error: 'Frais de livraison non calculés. Veuillez repasser par le panier.' }, { status: 400 });
      }
      const verification = verifyQuote(quoteToken, quoteSecret);
      if (!verification.valid) {
        return NextResponse.json({ error: 'Le devis de livraison a expiré. Veuillez repasser par le panier.' }, { status: 400 });
      }
      const quote = verification.payload;
      if (quote.c !== shippingAddress.country || quote.z !== shippingAddress.postal_code) {
        return NextResponse.json({ error: 'L\'adresse de livraison a changé. Veuillez recalculer les frais depuis le panier.' }, { status: 400 });
      }
      shippingTotal = quote.t;
    }

    const subtotal = parseFloat(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
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
    const currency = (tenant.currency ?? 'EUR').toUpperCase();
    const finalLink = method.method === 'paypal'
      ? `${method.extra.link.replace(/\/+$/, '')}/${total.toFixed(2)}${currency}`
      : method.extra.link;

    const active = await upsertActiveCheckoutSession({
      supabase,
      tenantId: tenant.id,
      customerId: sessionCustomer?.id ?? null,
      payload: {
        email,
        full_name: fullName ?? null,
        phone: phone ?? null,
        fulfillment_type: fulfillmentType,
        shipping_address: shippingAddress ?? null,
        shipping_details: shippingDetails ?? null,
        shipping_total: shippingTotal,
        ambassador_discount_amount: ambassadorDiscount,
        items,
        payment_method: 'external_link',
        external_payment_type: method.method,
        external_payment_label: method.label ?? method.method,
        external_payment_link: finalLink,
        consent_terms_accepted: consentState.showTermsCheckbox ? true : null,
        consent_terms_doc_version: consentState.showTermsCheckbox ? consentState.termsDocVersion : null,
        consent_marketing_accepted: consentState.showMarketingCheckbox ? marketingOptIn === true : null,
      },
    });

    await recordNalaCheckoutStarted({
      supabase,
      tenantId: tenant.id,
      checkoutSessionId: active.id,
      candidates: nalaAttributions,
      items,
      currency,
    });

    // Switching the active purchase intent away from card payment invalidates
    // the old pending PaymentIntent. A captured/succeeded intent is never
    // cancelled here; Stripe will reject that transition and the webhook remains
    // the authority for successful payment.
    if (active.previousStripePaymentIntentId) {
      try {
        const stripe = getStripeClient('shop');
        const intent = await stripe.paymentIntents.retrieve(active.previousStripePaymentIntentId);
        if (intent.status !== 'succeeded' && intent.status !== 'canceled') {
          await stripe.paymentIntents.cancel(intent.id);
        }
      } catch (cancelError) {
        console.warn('[checkout/external-link] previous PaymentIntent cancellation failed:', cancelError);
      }
      await supabase
        .from('checkout_sessions')
        .update({ stripe_payment_intent_id: null })
        .eq('id', active.id)
        .eq('tenant_id', tenant.id);
    }

    if (sessionCustomer) {
      await saveCheckoutProfile({
        customerId: sessionCustomer.id,
        tenantId: tenant.id,
        fullName,
        phone,
        shippingAddress: fulfillmentType === 'pickup' ? null : shippingAddress,
      });
    }

    await notifyExternalPaymentAwaitingVerification({
      supabase,
      tenantId: tenant.id,
      checkoutSessionId: active.id,
    });

    const accessToken = generateCheckoutSessionAccessToken(active.id, email);
    return NextResponse.json({
      sessionId: active.id,
      link: finalLink,
      amount: total,
      currency,
      isPaypal: method.method === 'paypal',
      label: method.label ?? method.method,
      accessToken,
      reusedCheckout: active.reused,
    });
  } catch (err) {
    console.error('[checkout/external-link] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
