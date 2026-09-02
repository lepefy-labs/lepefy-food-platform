import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { verifyQuote } from '@/lib/shipping/quoteToken';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { saveCheckoutProfile } from '@/lib/customers/saveCheckoutProfile';
import { resolveCheckoutAmbassadorDiscount } from '@/lib/ambassador/resolveCheckoutAmbassadorDiscount';
import { resolveCheckoutConsentState } from '@/lib/legal/resolveCheckoutConsentState';
import { registerCheckoutConsent } from '@/lib/legal/registerCheckoutConsent';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import { isE2ERequest } from '@/lib/e2e/isE2ERequest';
import { upsertActiveCheckoutSession } from '@/lib/checkout/activeCheckoutSession';
import { recordNalaCheckoutStarted } from '@/lib/ai/nalaConversionAttribution';

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
  shippingTotal: number;
  shippingDetails: Record<string, unknown> | null;
  quoteToken?: string | null;
  paymentMethod?: 'stripe' | 'in_store';
  termsAccepted?: boolean;
  marketingOptIn?: boolean;
  nalaAttributions?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const stripe = getStripeClient('shop');
    const isTestRequest = isE2ERequest();
    const body: CheckoutBody = await req.json();
    const {
      items: rawItems, shippingAddress, fulfillmentType, email,
      phone, fullName, shippingDetails, quoteToken,
      paymentMethod = 'stripe', termsAccepted, marketingOptIn, nalaAttributions,
    } = body;

    if (!rawItems?.length || !email) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(tenantSlug);
    const supabase = createServiceClient();
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
      console.error('[checkout] products lookup error:', productsError);
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

    const stockDecrementItems = Array.from(quantityByProduct.entries()).map(([productId, quantity]) => ({
      product_id: productId,
      quantity,
    }));

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
      if (!quoteSecret) {
        console.error('[checkout] TRACKING_SECRET manquant — impossible de vérifier le devis');
        return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
      }
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

    const consentTermsAccepted = consentState.showTermsCheckbox ? true : null;
    const consentTermsDocVersion = consentState.showTermsCheckbox ? consentState.termsDocVersion : null;
    const consentMarketingAccepted = consentState.showMarketingCheckbox ? marketingOptIn === true : null;

    if (paymentMethod === 'in_store') {
      const { error: stockError } = await supabase.rpc('decrement_stock_for_order', { items: stockDecrementItems });
      if (stockError) {
        return NextResponse.json({
          error: 'Un ou plusieurs articles ne sont plus disponibles dans la quantité demandée. Veuillez repasser par le panier.',
        }, { status: 409 });
      }

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          tenant_id: tenant.id,
          customer_id: sessionCustomer?.id ?? null,
          email,
          full_name: fullName ?? null,
          fulfillment_type: fulfillmentType,
          shipping_address: shippingAddress ?? null,
          shipping_details: shippingDetails ?? null,
          subtotal,
          shipping_cost: shippingTotal,
          total,
          ambassador_discount_amount: ambassadorDiscount,
          payment_method: 'in_store',
          payment_status: 'pending',
          status: 'preparing',
          notes: phone ? `Téléphone: ${phone}` : null,
          is_test: isTestRequest,
        })
        .select('id')
        .single();

      if (orderError || !order) {
        console.error('[checkout] in_store order insert error:', orderError);
        return NextResponse.json({ error: 'Erreur lors de la création de la commande.' }, { status: 500 });
      }

      const orderItemsPayload = items.map((item) => ({
        order_id: order.id,
        tenant_id: tenant.id,
        product_id: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.price * item.quantity,
        storage_type: item.storage_type ?? 'dry',
      }));
      const { error: itemsError } = await (supabase as unknown as {
        from(table: 'order_items'): { insert(data: unknown[]): Promise<{ error: unknown }> };
      }).from('order_items').insert(orderItemsPayload);
      if (itemsError) console.error('[checkout] in_store order_items insert error:', itemsError, '— order_id:', order.id);

      if (sessionCustomer) {
        await saveCheckoutProfile({
          customerId: sessionCustomer.id,
          tenantId: tenant.id,
          fullName,
          phone,
          shippingAddress: fulfillmentType === 'pickup' ? null : shippingAddress,
        });
      }

      try {
        await registerCheckoutConsent(supabase, {
          tenantId: tenant.id,
          orderId: order.id,
          customerId: sessionCustomer?.id ?? null,
          termsAccepted: consentTermsAccepted,
          termsDocVersion: consentTermsDocVersion,
          marketingAccepted: consentMarketingAccepted,
        });
      } catch (consentErr) {
        console.error('[checkout] registerCheckoutConsent (in_store) failed:', consentErr, '— order_id:', order.id);
      }

      return NextResponse.json({ orderId: order.id });
    }

    // A logged-in customer owns one recoverable purchase intent. Repeated
    // checkout submissions refresh it instead of multiplying sessions/intents.
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
        payment_method: 'stripe',
        external_payment_type: null,
        external_payment_label: null,
        external_payment_link: null,
        consent_terms_accepted: consentTermsAccepted,
        consent_terms_doc_version: consentTermsDocVersion,
        consent_marketing_accepted: consentMarketingAccepted,
      },
    });

    await recordNalaCheckoutStarted({
      supabase,
      tenantId: tenant.id,
      checkoutSessionId: active.id,
      candidates: nalaAttributions,
      items,
      currency: tenant.currency ?? 'EUR',
    });

    let paymentIntent = null;
    if (active.previousStripePaymentIntentId) {
      try {
        const existing = await stripe.paymentIntents.retrieve(active.previousStripePaymentIntentId);
        if (existing.status !== 'canceled' && existing.status !== 'succeeded') {
          paymentIntent = await stripe.paymentIntents.update(existing.id, {
            amount: Math.round(total * 100),
            metadata: { session_id: active.id, tenant_id: tenant.id },
          });
        }
      } catch (reuseError) {
        console.warn('[checkout] PaymentIntent reuse failed, creating replacement:', reuseError);
      }
    }

    if (!paymentIntent) {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(total * 100),
        currency: tenant.currency ?? 'eur',
        automatic_payment_methods: { enabled: true },
        metadata: { session_id: active.id, tenant_id: tenant.id },
      });
      await supabase.from('payment_funnel_logs').insert({
        tenant_id: tenant.id,
        module: 'shop',
        reference_id: active.id,
        event_type: 'intent_created',
        detail: { reused_checkout: active.reused },
      });
    }

    const { error: intentUpdateError } = await supabase
      .from('checkout_sessions')
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq('id', active.id)
      .eq('tenant_id', tenant.id);
    if (intentUpdateError) console.error('[checkout] Failed to persist stripe_payment_intent_id:', intentUpdateError);

    if (sessionCustomer) {
      await saveCheckoutProfile({
        customerId: sessionCustomer.id,
        tenantId: tenant.id,
        fullName,
        phone,
        shippingAddress: fulfillmentType === 'pickup' ? null : shippingAddress,
      });
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      sessionId: active.id,
      reusedCheckout: active.reused,
    });
  } catch (err) {
    console.error('[checkout] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
