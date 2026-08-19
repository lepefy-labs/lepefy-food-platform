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

// Agente e2e Fase 0 — NON instancié au scope module (comme avant) : la
// résolution de la clé dépend désormais de la requête en cours (token e2e
// éventuel), donc getStripeClient() doit être appelé DANS le handler, où
// next/headers() a un contexte de requête valide.
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
  termsAccepted?:     boolean;
  marketingOptIn?:    boolean;
}

export async function POST(req: NextRequest) {
  try {
    const stripe = getStripeClient('shop');
    const isTestRequest = isE2ERequest();
    const body: CheckoutBody = await req.json();
    const {
      items: rawItems, shippingAddress, fulfillmentType, email,
      phone, fullName, shippingDetails, quoteToken,
      paymentMethod = 'stripe',
      termsAccepted, marketingOptIn,
    } = body;

    if (!rawItems?.length || !email) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant     = await getTenant(tenantSlug);
    const supabase   = createServiceClient();

    // ── Session client optionnelle ───────────────────────────────────────────
    // null pour un guest : le parcours guest reste identique à aujourd'hui.
    const sessionCustomer = await getSessionCustomer(tenant.id);

    // ── Consentement (Ciclo 5) — la décision "faut-il montrer la case" reste
    // recalculée ici, jamais fournie par le client : seul son choix effectif
    // (case cochée ou non) est transmis. Si la case CGV était obligatoire et
    // n'a pas été cochée, on rejette avant toute création de PaymentIntent.
    const consentState = await resolveCheckoutConsentState(tenant.id, sessionCustomer?.id ?? null);
    if (consentState.showTermsCheckbox && termsAccepted !== true) {
      return NextResponse.json(
        { error: 'Merci d\'accepter les Conditions Générales de Vente pour continuer.' },
        { status: 400 },
      );
    }

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

    // ── Contrôle stock (avant paiement — "fail fast") ────────────────────────
    // Ne suffit pas seul : une race condition reste possible entre ce contrôle
    // et la confirmation réelle du paiement. C'est une première barrière pour
    // le cas courant, pas la protection définitive (cf. décrément atomique
    // plus bas / dans le webhook Stripe).
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

    const stockDecrementItems = Array.from(quantityByProduct.entries()).map(
      ([productId, quantity]) => ({ product_id: productId, quantity }),
    );

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

    // ── Sconto ambassador primo ordine ───────────────────────────────────────
    // Ricalcolato server-side allo stesso modo dell'anteprima affichée dans le
    // récapitulatif (/api/checkout/ambassador-discount) : source de vérité
    // pour le montant réellement débité (PaymentIntent Stripe ou commande
    // in_store créée directement ci-dessous), jamais une valeur venant du
    // client.
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

    // ── Valeurs de consentement à transporter (Ciclo 5) — null quand la case
    // correspondante n'était pas affichée (déjà à jour), jamais depuis le
    // choix brut du client sur le "faut-il montrer" (recalculé plus haut).
    const consentTermsAccepted     = consentState.showTermsCheckbox ? true : null;
    const consentTermsDocVersion   = consentState.showTermsCheckbox ? consentState.termsDocVersion : null;
    const consentMarketingAccepted = consentState.showMarketingCheckbox ? marketingOptIn === true : null;

    // ── In-store payment: create order directly, no Stripe ──────────────────
    if (paymentMethod === 'in_store') {
      // Décrément atomique AVANT la création de la commande : aucun paiement
      // Stripe n'a eu lieu pour ce flux (paiement en boutique au retrait), donc
      // en cas d'échec (race condition depuis le contrôle ci-dessus) on peut
      // simplement rejeter la commande — rien à rembourser, rien à annuler.
      const { error: stockError } = await supabase.rpc('decrement_stock_for_order', {
        items: stockDecrementItems,
      });

      if (stockError) {
        console.warn('[checkout] in_store stock decrement failed:', stockError.message);
        return NextResponse.json(
          {
            error:
              'Un ou plusieurs articles ne sont plus disponibles dans la quantité demandée. ' +
              'Veuillez repasser par le panier.',
          },
          { status: 409 },
        );
      }

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          tenant_id:        tenant.id,
          customer_id:      sessionCustomer?.id ?? null,
          email,
          full_name:        fullName ?? null,
          fulfillment_type: fulfillmentType,
          shipping_address: shippingAddress ?? null,
          shipping_details: shippingDetails ?? null,
          subtotal,
          shipping_cost:    shippingTotal,
          total,
          ambassador_discount_amount: ambassadorDiscount,
          payment_method:   'in_store',
          payment_status:   'pending',
          status:           'preparing',
          notes:            phone ? `Téléphone: ${phone}` : null,
          is_test:          isTestRequest,
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

      // Mémorisation du profil (nom/téléphone + adresse par défaut) pour
      // pré-remplir les commandes suivantes. Ne lève jamais : la commande est
      // déjà créée, un échec ici ne doit rien annuler (même principe que le
      // hook loyalty). Pour un retrait en boutique, shippingAddress est null
      // → seuls le nom et le téléphone sont enregistrés.
      if (sessionCustomer) {
        await saveCheckoutProfile({
          customerId:      sessionCustomer.id,
          tenantId:        tenant.id,
          fullName,
          phone,
          shippingAddress: fulfillmentType === 'pickup' ? null : shippingAddress,
        });
      }

      // ── Consentement (Ciclo 5) — in_store crée order_id immédiatement
      // (aucun PaymentIntent/webhook pour ce flux) : c'est donc ici, pas
      // ailleurs, que le consentement doit être enregistré. Best-effort.
      try {
        await registerCheckoutConsent(supabase, {
          tenantId:   tenant.id,
          orderId:    order.id,
          customerId: sessionCustomer?.id ?? null,
          termsAccepted:     consentTermsAccepted,
          termsDocVersion:   consentTermsDocVersion,
          marketingAccepted: consentMarketingAccepted,
        });
      } catch (consentErr) {
        console.error('[checkout] registerCheckoutConsent (in_store) failed:', consentErr, '— order_id:', order.id);
      }

      return NextResponse.json({ orderId: order.id });
    }

    // ── Stripe payment: save checkout_session, create PaymentIntent ──────────
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
        consent_terms_accepted:    consentTermsAccepted,
        consent_terms_doc_version: consentTermsDocVersion,
        consent_marketing_accepted: consentMarketingAccepted,
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

    // Persistance du PaymentIntent id sur la session — nécessaire pour
    // pouvoir l'annuler/le mettre à jour plus tard (PATCH /api/checkout-sessions/[id]).
    // Best-effort, même principe que saveCheckoutProfile ci-dessous : un
    // échec ici ne doit jamais bloquer la réponse au client, le paiement
    // reste possible même sans cette persistance.
    const { error: intentIdUpdateError } = await supabase
      .from('checkout_sessions')
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq('id', session.id);

    if (intentIdUpdateError) {
      console.error('[checkout] Failed to persist stripe_payment_intent_id on session:', intentIdUpdateError,
        '— session:', session.id, '— intent:', paymentIntent.id);
    }

    // Idem branche Stripe — après la création du PaymentIntent, jamais avant :
    // aucun échec de cette mémorisation ne peut empêcher le client de payer.
    if (sessionCustomer) {
      await saveCheckoutProfile({
        customerId:      sessionCustomer.id,
        tenantId:        tenant.id,
        fullName,
        phone,
        shippingAddress: fulfillmentType === 'pickup' ? null : shippingAddress,
      });
    }

    return NextResponse.json({ clientSecret: paymentIntent.client_secret, sessionId: session.id });
  } catch (err) {
    console.error('[checkout] unhandled error:', err);
    return NextResponse.json(
      { error: 'Erreur serveur. Veuillez réessayer.' },
      { status: 500 },
    );
  }
}
