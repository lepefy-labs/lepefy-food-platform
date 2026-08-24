import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { verifyQuote } from '@/lib/shipping/quoteToken';
import { isValidCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import { resolveCheckoutAmbassadorDiscount } from '@/lib/ambassador/resolveCheckoutAmbassadorDiscount';
import { checkoutExpiryFromNow } from '@/lib/checkout/activeCheckoutSession';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import type { ShippingAddress, TenantPaymentMethod } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const stripe = getStripeClient('shop');
const MAX_QUANTITY_PER_ITEM = 999;

interface CartItemPayload {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
}

interface CheckoutSessionRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  email: string;
  full_name: string | null;
  phone: string | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: ShippingAddress | null;
  shipping_details: Record<string, unknown> | null;
  shipping_total: number;
  ambassador_discount_amount: number | null;
  items: CartItemPayload[];
  status: 'open' | 'completed' | 'cancelled' | 'expired';
  expires_at: string;
  payment_method: 'stripe' | 'external_link';
  external_payment_type: string | null;
  external_payment_label: string | null;
  external_payment_link: string | null;
  stripe_payment_intent_id: string | null;
  consent_terms_accepted: boolean | null;
  consent_terms_doc_version: number | null;
  consent_marketing_accepted: boolean | null;
  created_at: string;
}

function toClientShape(session: CheckoutSessionRow) {
  return {
    id: session.id,
    email: session.email,
    fullName: session.full_name,
    phone: session.phone,
    fulfillmentType: session.fulfillment_type,
    shippingAddress: session.shipping_address,
    shippingDetails: session.shipping_details,
    shippingTotal: session.shipping_total,
    items: session.items,
    paymentMethod: session.payment_method,
    externalPaymentType: session.external_payment_type,
    externalPaymentLabel: session.external_payment_label,
    externalPaymentLink: session.external_payment_link,
  };
}

type AuthResult =
  | { ok: true; session: CheckoutSessionRow }
  | { ok: false; status: number; error: string };

async function loadAndAuthorizeSession(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  sessionId: string,
  sessionCustomerId: string | null,
  accessToken: string | null,
): Promise<AuthResult> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('checkout_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (error) {
    console.error('[checkout-sessions] lookup error:', error);
    return { ok: false, status: 500, error: 'Erreur serveur. Veuillez réessayer.' };
  }

  if (!data) {
    // Expiry is durable, never a hidden client-side convention.
    await supabase
      .from('checkout_sessions')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .lte('expires_at', nowIso);
    return { ok: false, status: 404, error: 'Session de paiement introuvable ou expirée.' };
  }

  const session = data as CheckoutSessionRow;
  if (session.customer_id) {
    if (!sessionCustomerId || sessionCustomerId !== session.customer_id) {
      return { ok: false, status: 403, error: 'Accès non autorisé à cette session.' };
    }
  } else if (!accessToken || !isValidCheckoutSessionAccessToken(session.id, session.email, accessToken)) {
    return { ok: false, status: 403, error: 'Accès non autorisé à cette session.' };
  }

  return { ok: true, session };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const supabase = createServiceClient();
    const sessionCustomer = await getSessionCustomer(tenant.id);
    const accessToken = req.nextUrl.searchParams.get('token');

    const auth = await loadAndAuthorizeSession(
      supabase, tenant.id, params.id, sessionCustomer?.id ?? null, accessToken,
    );
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    return NextResponse.json(toClientShape(auth.session));
  } catch (err) {
    console.error('[checkout-sessions][GET] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}

interface PatchBody {
  items?: Array<{ productId: string; quantity: number }>;
  shippingAddress?: ShippingAddress | null;
  fulfillmentType?: 'delivery' | 'pickup';
  shippingTotal?: number;
  shippingDetails?: Record<string, unknown> | null;
  quoteToken?: string | null;
  paymentMethod?: 'stripe' | 'external_link';
  externalPaymentMethodId?: string;
  accessToken?: string;
  status?: 'cancelled';
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body: PatchBody = await req.json();
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const supabase = createServiceClient();
    const sessionCustomer = await getSessionCustomer(tenant.id);

    const auth = await loadAndAuthorizeSession(
      supabase, tenant.id, params.id, sessionCustomer?.id ?? null, body.accessToken ?? null,
    );
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const session = auth.session;
    const now = new Date();
    const nowIso = now.toISOString();

    if (body.status === 'cancelled') {
      if (session.payment_method === 'stripe' && session.stripe_payment_intent_id) {
        try {
          const intent = await stripe.paymentIntents.retrieve(session.stripe_payment_intent_id);
          if (intent.status !== 'succeeded' && intent.status !== 'canceled') {
            await stripe.paymentIntents.cancel(intent.id);
          }
        } catch (cancelErr) {
          console.warn('[checkout-sessions][PATCH] PaymentIntent cancel failed (non-blocking):', cancelErr,
            '— id:', session.stripe_payment_intent_id);
        }
      }

      const { error: cancelError } = await supabase
        .from('checkout_sessions')
        .update({
          status: 'cancelled',
          stripe_payment_intent_id: null,
          last_activity_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', session.id)
        .eq('tenant_id', tenant.id);

      if (cancelError) {
        console.error('[checkout-sessions][PATCH] cancel error:', cancelError, '— session:', session.id);
        return NextResponse.json({ error: 'Erreur lors de l\'annulation de la session.' }, { status: 500 });
      }
      return NextResponse.json({ id: session.id, status: 'cancelled' as const });
    }

    let items = session.items;
    if (body.items) {
      if (!body.items.length) return NextResponse.json({ error: 'Le panier ne peut pas être vide.' }, { status: 400 });
      for (const item of body.items) {
        if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_ITEM) {
          return NextResponse.json({ error: 'Article invalide.' }, { status: 400 });
        }
      }

      const productIds = [...new Set(body.items.map((item) => item.productId))];
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
        console.error('[checkout-sessions][PATCH] products lookup error:', productsError);
        return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
      }

      const productById = new Map(dbProducts.map((product) => [product.id, product]));
      if (productIds.some((id) => !productById.has(id))) {
        return NextResponse.json({ error: 'Certains articles de votre panier ne sont plus disponibles.' }, { status: 400 });
      }

      const quantityByProduct = new Map<string, number>();
      for (const item of body.items) quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? 0) + item.quantity);
      const insufficientStock: string[] = [];
      for (const [productId, requestedQty] of quantityByProduct) {
        const product = productById.get(productId)!;
        if (product.stock < requestedQty) insufficientStock.push(product.name);
      }
      if (insufficientStock.length > 0) {
        return NextResponse.json({ error: `Stock insuffisant pour : ${insufficientStock.join(', ')}.` }, { status: 400 });
      }

      items = body.items.map((item) => {
        const product = productById.get(item.productId)!;
        return {
          productId: product.id,
          name: product.name,
          price: product.price,
          quantity: item.quantity,
          storage_type: product.storage_type ?? 'dry',
        };
      });
    }

    const fulfillmentType = body.fulfillmentType ?? session.fulfillment_type;
    const shippingAddress = body.shippingAddress !== undefined ? body.shippingAddress : session.shipping_address;
    const shippingDetails = body.shippingDetails !== undefined ? body.shippingDetails : session.shipping_details;
    let shippingTotal = session.shipping_total;

    if (body.shippingTotal !== undefined) {
      if (fulfillmentType === 'pickup') {
        shippingTotal = 0;
      } else {
        const quoteSecret = process.env.TRACKING_SECRET;
        if (!quoteSecret) return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
        if (!body.quoteToken || !shippingAddress) {
          return NextResponse.json({ error: 'Frais de livraison non calculés. Veuillez repasser par le panier.' }, { status: 400 });
        }
        const verification = verifyQuote(body.quoteToken, quoteSecret);
        if (!verification.valid) {
          return NextResponse.json({ error: 'Le devis de livraison a expiré. Veuillez repasser par le panier.' }, { status: 400 });
        }
        const quote = verification.payload;
        if (quote.c !== shippingAddress.country || quote.z !== shippingAddress.postal_code) {
          return NextResponse.json({ error: 'L\'adresse de livraison a changé. Veuillez recalculer les frais depuis le panier.' }, { status: 400 });
        }
        shippingTotal = quote.t;
      }
    }

    const subtotal = parseFloat(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
    let ambassadorDiscount = session.ambassador_discount_amount ?? 0;
    if (body.items) {
      ambassadorDiscount = await resolveCheckoutAmbassadorDiscount({
        tenant: {
          id: tenant.id,
          ambassador_min_purchase_amount: tenant.ambassador_min_purchase_amount,
          ambassador_commission_mode: tenant.ambassador_commission_mode,
          ambassador_split_pool_amount: tenant.ambassador_split_pool_amount,
          ambassador_split_pool_ambassador_percent: tenant.ambassador_split_pool_ambassador_percent,
          ambassador_first_order_discount_type: tenant.ambassador_first_order_discount_type,
          ambassador_first_order_discount_value: tenant.ambassador_first_order_discount_value,
        },
        customerId: session.customer_id,
        subtotal,
      });
    }
    const total = parseFloat((subtotal + shippingTotal - ambassadorDiscount).toFixed(2));
    const paymentMethod = body.paymentMethod ?? session.payment_method;

    let stripePaymentIntentId = session.stripe_payment_intent_id;
    let externalPaymentType = session.external_payment_type;
    let externalPaymentLabel = session.external_payment_label;
    let externalPaymentLink = session.external_payment_link;
    let clientSecret: string | null = null;
    let externalLinkResponse: { link: string; amount: number; currency: string; isPaypal: boolean; label: string } | null = null;

    if (paymentMethod === 'stripe') {
      externalPaymentType = null;
      externalPaymentLabel = null;
      externalPaymentLink = null;

      if (stripePaymentIntentId) {
        try {
          const intent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
          if (intent.status === 'canceled' || intent.status === 'succeeded') {
            stripePaymentIntentId = null;
          } else {
            const updated = await stripe.paymentIntents.update(intent.id, {
              amount: Math.round(total * 100),
              metadata: { session_id: session.id, tenant_id: tenant.id },
            });
            clientSecret = updated.client_secret;
          }
        } catch (stripeErr) {
          console.warn('[checkout-sessions][PATCH] PaymentIntent update unavailable, will recreate on pay:', stripeErr);
          stripePaymentIntentId = null;
        }
      }
    } else {
      if (session.payment_method === 'stripe' && stripePaymentIntentId) {
        try {
          const intent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
          if (intent.status !== 'succeeded' && intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id);
        } catch (cancelErr) {
          console.warn('[checkout-sessions][PATCH] PaymentIntent cancel failed (non-blocking):', cancelErr);
        }
        stripePaymentIntentId = null;
      }

      const needsLinkRebuild = body.paymentMethod !== undefined || body.items !== undefined
        || body.shippingTotal !== undefined || body.externalPaymentMethodId !== undefined;
      if (needsLinkRebuild) {
        const methodId = body.externalPaymentMethodId;
        if (!methodId && session.payment_method !== 'external_link') {
          return NextResponse.json({ error: 'Moyen de paiement manquant.' }, { status: 400 });
        }

        if (methodId) {
          const { data: methodRow } = await supabase
            .from('tenant_payment_methods')
            .select('*')
            .eq('id', methodId)
            .eq('tenant_id', tenant.id)
            .eq('active', true)
            .maybeSingle();
          const method = methodRow as TenantPaymentMethod | null;
          if (!method || method.method === 'bank_transfer' || method.method === 'cash' || !method.extra?.link) {
            return NextResponse.json({ error: 'Moyen de paiement invalide.' }, { status: 400 });
          }
          const currency = (tenant.currency ?? 'EUR').toUpperCase();
          const finalLink = method.method === 'paypal'
            ? `${method.extra.link.replace(/\/+$/, '')}/${total.toFixed(2)}${currency}`
            : method.extra.link;
          externalPaymentType = method.method;
          externalPaymentLabel = method.label ?? method.method;
          externalPaymentLink = finalLink;
          externalLinkResponse = {
            link: finalLink,
            amount: total,
            currency,
            isPaypal: method.method === 'paypal',
            label: method.label ?? method.method,
          };
        } else if (externalPaymentType === 'paypal' && externalPaymentLink) {
          const currency = (tenant.currency ?? 'EUR').toUpperCase();
          const base = externalPaymentLink.replace(/\/[0-9.,]+[A-Z]{3}$/i, '');
          externalPaymentLink = `${base}/${total.toFixed(2)}${currency}`;
          externalLinkResponse = {
            link: externalPaymentLink,
            amount: total,
            currency,
            isPaypal: true,
            label: externalPaymentLabel ?? 'PayPal',
          };
        } else if (externalPaymentLink) {
          externalLinkResponse = {
            link: externalPaymentLink,
            amount: total,
            currency: (tenant.currency ?? 'EUR').toUpperCase(),
            isPaypal: false,
            label: externalPaymentLabel ?? externalPaymentType ?? 'Autre',
          };
        }
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('checkout_sessions')
      .update({
        items,
        fulfillment_type: fulfillmentType,
        shipping_address: shippingAddress,
        shipping_details: shippingDetails,
        shipping_total: shippingTotal,
        ambassador_discount_amount: ambassadorDiscount,
        payment_method: paymentMethod,
        stripe_payment_intent_id: stripePaymentIntentId,
        external_payment_type: externalPaymentType,
        external_payment_label: externalPaymentLabel,
        external_payment_link: externalPaymentLink,
        last_activity_at: nowIso,
        updated_at: nowIso,
        expires_at: checkoutExpiryFromNow(now),
      })
      .eq('id', session.id)
      .eq('tenant_id', tenant.id)
      .select('*')
      .single();

    if (updateError || !updated) {
      console.error('[checkout-sessions][PATCH] update error:', updateError, '— session:', session.id);
      return NextResponse.json({ error: 'Erreur lors de la mise à jour de la session.' }, { status: 500 });
    }

    return NextResponse.json({
      ...toClientShape(updated as CheckoutSessionRow),
      clientSecret,
      ...(externalLinkResponse ?? {}),
    });
  } catch (err) {
    console.error('[checkout-sessions][PATCH] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
