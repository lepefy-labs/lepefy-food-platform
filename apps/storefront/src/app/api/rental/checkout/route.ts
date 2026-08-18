import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import type { RentalCheckoutItemInput, RentalPaymentIntentMetadata } from '@lepefy/types';

const stripe = getStripeClient('rental');

const MAX_QUANTITY_PER_ITEM = 999;

interface RentalCheckoutBody {
  service_offering_id: string;
  items:               RentalCheckoutItemInput[];
  pickup_date:         string;
  customer_name:       string;
  customer_email:      string;
  customer_phone?:     string | null;
}

export async function POST(req: NextRequest) {
  try {
    const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(slug);

    if (!tenant.services_enabled) {
      return NextResponse.json({ error: 'Module services non activé.' }, { status: 404 });
    }

    const body: RentalCheckoutBody = await req.json();
    const {
      service_offering_id, items: rawItems, pickup_date,
      customer_name, customer_email, customer_phone,
    } = body;

    if (!service_offering_id || !rawItems?.length || !pickup_date
      || !customer_name?.trim() || !customer_email?.trim()) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    for (const i of rawItems) {
      if (!i.rental_item_id || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > MAX_QUANTITY_PER_ITEM) {
        return NextResponse.json({ error: 'Article invalide.' }, { status: 400 });
      }
    }

    const pickupDateObj = new Date(pickup_date);
    if (Number.isNaN(pickupDateObj.getTime()) || pickupDateObj < new Date(new Date().toDateString())) {
      return NextResponse.json({ error: 'Date de retrait invalide.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: offering } = await supabase
      .from('service_offerings')
      .select('id, tenant_id, title, cta_type, active')
      .eq('id', service_offering_id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (!offering || !offering.active || offering.cta_type !== 'reservation') {
      return NextResponse.json({ error: 'Service introuvable ou non disponible.' }, { status: 404 });
    }

    const rentalItemIds = [...new Set(rawItems.map((i) => i.rental_item_id))];
    const { data: rentalItems } = await supabase
      .from('rental_items')
      .select('id, name, price_per_unit, stock_quantity, active')
      .eq('service_offering_id', offering.id)
      .in('id', rentalItemIds);

    const itemById = new Map(
      ((rentalItems ?? []) as { id: string; name: string; price_per_unit: number; stock_quantity: number; active: boolean }[])
        .map((r) => [r.id, r]),
    );

    if (rentalItemIds.some((id) => !itemById.has(id) || !itemById.get(id)!.active)) {
      return NextResponse.json({ error: 'Un ou plusieurs articles ne sont plus disponibles.' }, { status: 400 });
    }

    const quantityByItem = new Map<string, number>();
    for (const i of rawItems) {
      quantityByItem.set(i.rental_item_id, (quantityByItem.get(i.rental_item_id) ?? 0) + i.quantity);
    }

    // Contrôle préliminaire ("fail fast") — la vérification définitive et
    // atomique a lieu dans reserve_rental_stock() au moment du webhook.
    const insufficientStock: string[] = [];
    for (const [itemId, qty] of quantityByItem) {
      const item = itemById.get(itemId)!;
      if (item.stock_quantity < qty) insufficientStock.push(item.name);
    }
    if (insufficientStock.length > 0) {
      return NextResponse.json(
        { error: `Stock insuffisant pour : ${insufficientStock.join(', ')}.` },
        { status: 409 },
      );
    }

    const total = parseFloat(
      rawItems.reduce((sum, i) => sum + itemById.get(i.rental_item_id)!.price_per_unit * i.quantity, 0).toFixed(2),
    );

    const metadata: RentalPaymentIntentMetadata = {
      type:                 'rental_reservation',
      service_offering_id:  offering.id,
      tenant_id:            tenant.id,
      pickup_date:          pickup_date,
      items:                JSON.stringify(rawItems),
      customer_name:        customer_name.trim(),
      customer_email:       customer_email.trim(),
      customer_phone:       customer_phone?.trim() ?? '',
    };

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(total * 100),
      currency: tenant.currency ?? 'eur',
      metadata: metadata as unknown as Record<string, string>,
    });

    console.info('[rental/checkout] PaymentIntent created — id:', paymentIntent.id, '— service:', offering.id, '— amount:', paymentIntent.amount);

    await supabase.from('payment_funnel_logs').insert({
      tenant_id:    tenant.id,
      module:       'rental',
      event_type:   'intent_created',
      reference_id: offering.id,
      detail:       { amount: total },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('[rental/checkout] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
