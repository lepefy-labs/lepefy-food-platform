import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { saveCheckoutProfile } from '@/lib/customers/saveCheckoutProfile';
import { resolveOrCreateCustomer } from '@/lib/customers/resolveOrCreateCustomer';
import { resolveCheckoutAmbassadorDiscount } from '@/lib/ambassador/resolveCheckoutAmbassadorDiscount';
import { resolveCheckoutConsentState } from '@/lib/legal/resolveCheckoutConsentState';
import { generateCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import { upsertActiveCheckoutSession } from '@/lib/checkout/activeCheckoutSession';
import { notifyExternalPaymentAwaitingVerification } from '@/lib/notifications/notifyExternalPaymentAwaitingVerification';
import { recordNalaCheckoutStarted } from '@/lib/ai/nalaConversionAttribution';
import { validateCheckoutItems } from '@/lib/checkout/validateCheckoutItems';
import { verifyCheckoutShipping } from '@/lib/shipping/tariff/checkoutShipping';
import type { TenantPaymentMethod } from '@lepefy/types';

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

    // All payment entry points, including recovery, share this DB-backed gate.
    const validated = await validateCheckoutItems(supabase, tenant.id, rawItems);
    if (validated.ok === false) {
      return NextResponse.json(validated.body, { status: validated.status });
    }
    const { items, quantityByProduct } = validated;

    const subtotal = parseFloat(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
    // Frais de livraison vérifiés côté serveur : token legacy (provider_cost /
    // shadow) ou token V2 recalculé (forfait commercial). Jamais le montant du navigateur.
    const shipping = await verifyCheckoutShipping({
      supabase,
      tenant,
      fulfillmentType,
      address: shippingAddress,
      quoteToken,
      quantityByProduct,
      subtotal,
      clientShippingDetails: shippingDetails,
    });
    if (shipping.ok === false) {
      return NextResponse.json(shipping.body, { status: shipping.status });
    }
    const shippingTotal = shipping.shippingTotal;
    const serverShippingDetails = shipping.shippingDetails;
    let customerId = sessionCustomer?.id ?? null;
    if (!customerId) {
      try {
        customerId = (await resolveOrCreateCustomer({
          tenantId: tenant.id, email, phone, fullName, source: 'guest_checkout', supabase,
        })).id;
      } catch (identityError) {
        console.warn('[checkout/external-link] customer resolution failed:', identityError);
        return NextResponse.json({ error: 'Ces coordonnées correspondent à plusieurs profils. Contactez-nous pour continuer.' }, { status: 409 });
      }
    }
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
      customerId,
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
      customerId,
      payload: {
        email,
        full_name: fullName ?? null,
        phone: phone ?? null,
        fulfillment_type: fulfillmentType,
        shipping_address: shippingAddress ?? null,
        shipping_details: serverShippingDetails,
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

    if (customerId) {
      await saveCheckoutProfile({
        customerId,
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
