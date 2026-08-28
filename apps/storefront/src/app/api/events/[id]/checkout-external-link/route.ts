import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { notifyEventExternalPaymentAwaitingVerification } from '@/lib/notifications/notifyEventExternalPaymentAwaitingVerification';
import type { EventCheckoutItemInput, TenantPaymentMethod } from '@lepefy/types';

const MAX_QUANTITY_PER_TICKET = 999;

interface EventExternalLinkCheckoutBody {
  items:                   EventCheckoutItemInput[];
  customer_name:           string;
  customer_email:          string;
  customer_phone?:         string | null;
  externalPaymentMethodId: string;
}

// Phase 2 — paiement via lien externe (PayPal/Revolut/autre) pour la
// billetterie événementiel. Miroir des mêmes contrôles fail-fast que
// api/events/[id]/checkout/route.ts (capacité, ticket types actifs/prix
// depuis le DB) — route séparée car aucun PaymentIntent Stripe n'est créé
// ici : seulement une ligne event_reservation_requests en attente de
// confirmation manuelle admin.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(slug);

    if (!tenant.events_enabled) {
      return NextResponse.json({ error: 'Module événementiel non activé.' }, { status: 404 });
    }

    const body: EventExternalLinkCheckoutBody = await req.json();
    const { items: rawItems, customer_name, customer_email, customer_phone, externalPaymentMethodId } = body;

    if (!rawItems?.length || !customer_name?.trim() || !customer_email?.trim() || !externalPaymentMethodId) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    for (const i of rawItems) {
      if (!i.ticket_type_id || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > MAX_QUANTITY_PER_TICKET) {
        return NextResponse.json({ error: 'Formule invalide.' }, { status: 400 });
      }
    }

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

    const { data: eventRow } = await supabase
      .from('events')
      .select('id, tenant_id, status, capacity_remaining, title, date_start, location, booking_closes_at')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (!eventRow || eventRow.status !== 'published') {
      return NextResponse.json({ error: 'Événement introuvable ou non disponible.' }, { status: 404 });
    }

    if (eventRow.booking_closes_at && Date.now() >= new Date(eventRow.booking_closes_at).getTime()) {
      return NextResponse.json(
        { code: 'reservations_closed', error: 'Les réservations sont clôturées pour cet événement.' },
        { status: 409 },
      );
    }

    const ticketTypeIds = [...new Set(rawItems.map((i) => i.ticket_type_id))];
    const { data: ticketTypes } = await supabase
      .from('event_ticket_types')
      .select('id, label, price, active')
      .eq('event_id', eventRow.id)
      .in('id', ticketTypeIds);

    const ticketById = new Map(
      ((ticketTypes ?? []) as { id: string; label: string; price: number; active: boolean }[]).map((t) => [t.id, t]),
    );

    if (ticketTypeIds.some((id) => !ticketById.has(id) || !ticketById.get(id)!.active)) {
      return NextResponse.json({ error: 'Une ou plusieurs formules ne sont plus disponibles.' }, { status: 400 });
    }

    const totalQuantity = rawItems.reduce((s, i) => s + i.quantity, 0);

    if (eventRow.capacity_remaining < totalQuantity) {
      return NextResponse.json(
        { error: 'Capacité insuffisante pour le nombre de places demandées.' },
        { status: 409 },
      );
    }

    const total = parseFloat(
      rawItems.reduce((sum, i) => sum + ticketById.get(i.ticket_type_id)!.price * i.quantity, 0).toFixed(2),
    );

    const currency = (tenant.currency ?? 'EUR').toUpperCase();
    const finalLink =
      method.method === 'paypal'
        ? `${method.extra.link.replace(/\/+$/, '')}/${total.toFixed(2)}${currency}`
        : method.extra.link;

    const { data: request, error: requestError } = await supabase
      .from('event_reservation_requests')
      .insert({
        tenant_id:             tenant.id,
        event_id:              eventRow.id,
        items:                 rawItems,
        customer_name:         customer_name.trim(),
        customer_email:        customer_email.trim(),
        customer_phone:        customer_phone?.trim() || null,
        amount:                total,
        currency:              tenant.currency ?? 'eur',
        payment_method_type:   method.method,
        payment_method_label:  method.label ?? method.method,
        payment_link:          finalLink,
      })
      .select('id, created_at')
      .single();

    if (requestError || !request) {
      console.error('[events/checkout-external-link] event_reservation_requests insert error:', requestError);
      return NextResponse.json(
        { error: 'Erreur lors de la création de la demande de paiement.' },
        { status: 500 },
      );
    }

    console.info('[events/checkout-external-link] request created — id:', request.id, '— event:', eventRow.id,
      '— method:', method.method);

    const tenantNotificationDelivered = await notifyEventExternalPaymentAwaitingVerification({
      supabase,
      tenantId: tenant.id,
      requestId: request.id,
      event: {
        id: eventRow.id,
        title: eventRow.title,
        dateStart: eventRow.date_start,
        location: eventRow.location,
      },
      customer: {
        fullName: customer_name.trim(),
        email: customer_email.trim(),
        phone: customer_phone?.trim() || null,
      },
      paymentMethod: {
        type: method.method,
        label: method.label ?? method.method,
      },
      amount: total,
      currency,
      items: rawItems.map((item) => {
        const ticket = ticketById.get(item.ticket_type_id)!;
        return {
          ticketTypeId: item.ticket_type_id,
          name: ticket.label,
          price: Number(ticket.price),
          quantity: item.quantity,
        };
      }),
      createdAt: request.created_at,
    });

    if (!tenantNotificationDelivered) {
      console.warn('[events/checkout-external-link] tenant notification not delivered — request:', request.id);
    }

    return NextResponse.json({
      requestId: request.id,
      link:      finalLink,
      amount:    total,
      currency,
      isPaypal:  method.method === 'paypal',
      label:     method.label ?? method.method,
    });
  } catch (err) {
    console.error('[events/checkout-external-link] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
