import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { verifyQuote } from '@/lib/shipping/quoteToken';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

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
  items:           CartItemPayload[];
  shippingAddress: ShippingAddress | null;
  fulfillmentType: 'delivery' | 'pickup';
  email:           string;
  phone?:          string | null;
  fullName?:       string | null;
  shippingTotal:   number;
  shippingDetails: Record<string, unknown> | null;
  quoteToken?:     string | null;
  paymentMethod?:  'stripe' | 'in_store';
}

export async function POST(req: NextRequest) {
  try {
    const body: CheckoutBody = await req.json();
    const {
      items: rawItems, shippingAddress, fulfillmentType, email,
      phone, fullName, shippingDetails, quoteToken,
      paymentMethod = 'stripe',
    } = body;

    if (!rawItems?.length || !email) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant     = await getTenant(tenantSlug);
    const supabase   = createServiceClient();

    // ── Ricalcolo prezzi server-side ─────────────────────────────────────────
    // Il client invia solo productId + quantity come dati fidati: prezzo, nome
    // e storage_type vengono riletti dal DB per impedire manipolazioni.
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
      .select('id, name, price, storage_type')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .in('id', productIds) as {
        data: Array<{
          id:           string;
          name:         string;
          price:        number;
          storage_type: 'dry' | 'fresh' | 'frozen' | null;
        }> | null;
        error: unknown;
      };

    if (productsError || !dbProducts) {
      console.error('[checkout] products lookup error:', productsError);
      return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
    }

    const productById = new Map(dbProducts.map((p) => [p.id, p]));
    if (productIds.some((id) => !productById.has(id))) {
      return NextResponse.json(
        { error: 'Certains articles de votre panier ne sont plus disponibles.' },
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
    // pickup → 0; delivery → solo importo certificato dal token firmato
    // emesso da /api/shipping/quote per lo stesso paese/CAP.
    let shippingTotal = 0;

    if (fulfillmentType === 'delivery') {
      const quoteSecret = process.env.TRACKING_SECRET;
      if (!quoteSecret) {
        console.error('[checkout] TRACKING_SECRET manquant — impossible de vérifier le devis');
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
        console.warn('[checkout] quote token rejected — reason:', verification.reason);
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
    const total = parseFloat((subtotal + shippingTotal).toFixed(2));

    // ── In-store payment: create order directly, no Stripe ──────────────────
    if (paymentMethod === 'in_store') {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          tenant_id:        tenant.id,
          customer_id:      null,
          email,
          full_name:        fullName ?? null,
          fulfillment_type: fulfillmentType,
          shipping_address: shippingAddress ?? null,
          shipping_details: shippingDetails ?? null,
          subtotal,
          shipping_cost:    shippingTotal,
          total,
          payment_method:   'in_store',
          payment_status:   'pending',
          status:           'preparing',
          notes:            phone ? `Téléphone: ${phone}` : null,
        })
        .select('id')
        .single();

      if (orderError || !order) {
        console.error('[checkout] in_store order insert error:', orderError);
        return NextResponse.json(
          { error: 'Erreur lors de la création de la commande.' },
          { status: 500 },
        );
      }

      // Insert order_items
      const orderItemsPayload = items.map((i) => ({
        order_id:     order.id,
        tenant_id:    tenant.id,
        product_id:   i.productId ?? null,
        name:         i.name,
        price:        i.price,
        quantity:     i.quantity,
        subtotal:     i.price * i.quantity,
        storage_type: i.storage_type ?? 'dry',
      }));

      const { error: itemsError } = await (supabase as unknown as {
        from(table: 'order_items'): {
          insert(data: unknown[]): Promise<{ error: unknown }>;
        };
      }).from('order_items').insert(orderItemsPayload);

      if (itemsError) {
        console.error('[checkout] in_store order_items insert error:', itemsError, '— order_id:', order.id);
      } else {
        console.info('[checkout] in_store order created — id:', order.id, '— items:', orderItemsPayload.length);
      }

      return NextResponse.json({ orderId: order.id });
    }

    // ── Stripe payment: save checkout_session, create PaymentIntent ──────────
    const { data: session, error: sessionError } = await supabase
      .from('checkout_sessions')
      .insert({
        tenant_id:        tenant.id,
        email,
        full_name:        fullName ?? null,
        phone:            phone ?? null,
        fulfillment_type: fulfillmentType,
        shipping_address: shippingAddress ?? null,
        shipping_details: shippingDetails ?? null,
        shipping_total:   shippingTotal,
        items,
      })
      .select('id')
      .single();

    if (sessionError || !session) {
      console.error('[checkout] checkout_sessions insert error:', sessionError);
      return NextResponse.json(
        { error: 'Erreur lors de la création de la session de paiement.' },
        { status: 500 },
      );
    }

    console.info('[checkout] checkout_session created — id:', session.id, '— tenant:', tenant.id);

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(total * 100),
      currency: tenant.currency ?? 'eur',
      metadata: {
        session_id: session.id,
        tenant_id:  tenant.id,
      },
    });

    console.info('[checkout] PaymentIntent created — id:', paymentIntent.id, '— amount:', paymentIntent.amount);

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('[checkout] unhandled error:', err);
    return NextResponse.json(
      { error: 'Erreur serveur. Veuillez réessayer.' },
      { status: 500 },
    );
  }
}
