import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import type { RentalCheckoutItemInput, TenantPaymentMethod } from '@lepefy/types';

const MAX_QUANTITY_PER_ITEM = 999;

interface RentalExternalLinkCheckoutBody {
  service_offering_id:     string;
  items:                   RentalCheckoutItemInput[];
  pickup_date:              string;
  customer_name:           string;
  customer_email:          string;
  customer_phone?:         string | null;
  externalPaymentMethodId: string;
}

// Phase 3 — paiement via lien externe (PayPal/Revolut/autre) pour la
// location matériel. Miroir des mêmes contrôles fail-fast que
// api/rental/checkout/route.ts (articles actifs, stock, date de retrait
// valide) — route séparée car aucun PaymentIntent Stripe n'est créé ici :
// seulement une ligne rental_reservation_requests en attente de confirmation
// manuelle admin (voir Task 4).
export async function POST(req: NextRequest) {
  try {
    const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(slug);

    if (!tenant.services_enabled) {
      return NextResponse.json({ error: 'Module services non activé.' }, { status: 404 });
    }

    const body: RentalExternalLinkCheckoutBody = await req.json();
    const {
      service_offering_id, items: rawItems, pickup_date,
      customer_name, customer_email, customer_phone, externalPaymentMethodId,
    } = body;

    if (!service_offering_id || !rawItems?.length || !pickup_date
      || !customer_name?.trim() || !customer_email?.trim() || !externalPaymentMethodId) {
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

    // ── Résolution du moyen de paiement — TOUJOURS depuis la DB. ────────────
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
    // atomique reste reserve_rental_stock(), au moment de la confirmation
    // admin (voir createRentalReservationFromRequest, Task 2) — jamais ici.
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

    // ── Construction du lien (même règle que Phase 1/2 — Décision 4) ────────
    const currency = (tenant.currency ?? 'EUR').toUpperCase();
    const finalLink =
      method.method === 'paypal'
        ? `${method.extra.link.replace(/\/+$/, '')}/${total.toFixed(2)}${currency}`
        : method.extra.link;

    const { data: request, error: requestError } = await supabase
      .from('rental_reservation_requests')
      .insert({
        tenant_id:              tenant.id,
        service_offering_id:    offering.id,
        items:                  rawItems,
        pickup_date:             pickup_date,
        customer_name:           customer_name.trim(),
        customer_email:          customer_email.trim(),
        customer_phone:          customer_phone?.trim() || null,
        amount:                  total,
        currency:                tenant.currency ?? 'eur',
        payment_method_type:     method.method,
        payment_method_label:    method.label ?? method.method,
        payment_link:            finalLink,
      })
      .select('id')
      .single();

    if (requestError || !request) {
      console.error('[rental/checkout-external-link] rental_reservation_requests insert error:', requestError);
      return NextResponse.json(
        { error: 'Erreur lors de la création de la demande de paiement.' },
        { status: 500 },
      );
    }

    console.info('[rental/checkout-external-link] request created — id:', request.id, '— service:', offering.id,
      '— method:', method.method);

    return NextResponse.json({
      requestId: request.id,
      link:      finalLink,
      amount:    total,
      currency,
      isPaypal:  method.method === 'paypal',
      label:     method.label ?? method.method,
    });
  } catch (err) {
    console.error('[rental/checkout-external-link] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
