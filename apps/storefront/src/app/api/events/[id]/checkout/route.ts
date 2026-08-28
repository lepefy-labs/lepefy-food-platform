import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import type { EventCheckoutItemInput, EventPaymentIntentMetadata } from '@lepefy/types';

// Agente e2e Fase 0 — voir api/checkout/route.ts : getStripeClient() ne peut
// plus être instancié au scope module, la résolution de clé dépend désormais
// de la requête en cours (next/headers()).
const MAX_QUANTITY_PER_TICKET = 999;

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

interface EventCheckoutBody {
  items:          EventCheckoutItemInput[];
  customer_name:  string;
  customer_email: string;
  customer_phone?: string | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const stripe = getStripeClient('event');
    const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(slug);

    if (!tenant.events_enabled) {
      return NextResponse.json({ error: 'Module événementiel non activé.' }, { status: 404 });
    }

    const body: EventCheckoutBody = await req.json();
    const { items: rawItems, customer_name, customer_email, customer_phone } = body;

    if (!rawItems?.length || !customer_name?.trim() || !customer_email?.trim()) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    if (!isValidEmail(customer_email)) {
      return NextResponse.json({ error: 'Adresse email invalide.' }, { status: 400 });
    }

    for (const i of rawItems) {
      if (!i.ticket_type_id || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > MAX_QUANTITY_PER_TICKET) {
        return NextResponse.json({ error: 'Formule invalide.' }, { status: 400 });
      }
    }

    const supabase = createServiceClient();

    const { data: eventRow } = await supabase
      .from('events')
      .select('id, tenant_id, status, capacity_remaining, title, booking_closes_at')
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

    // Contrôle préliminaire ("fail fast") — la vérification définitive et
    // atomique a lieu dans reserve_event_capacity() au moment du webhook.
    if (eventRow.capacity_remaining < totalQuantity) {
      return NextResponse.json(
        { error: 'Capacité insuffisante pour le nombre de places demandées.' },
        { status: 409 },
      );
    }

    const total = parseFloat(
      rawItems.reduce((sum, i) => sum + ticketById.get(i.ticket_type_id)!.price * i.quantity, 0).toFixed(2),
    );

    const metadata: EventPaymentIntentMetadata = {
      type:            'event_reservation',
      event_id:        eventRow.id,
      tenant_id:       tenant.id,
      items:           JSON.stringify(rawItems),
      customer_name:   customer_name.trim(),
      customer_email:  customer_email.trim(),
      customer_phone:  customer_phone?.trim() ?? '',
    };

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(total * 100),
      currency: tenant.currency ?? 'eur',
      payment_method_types: ['card'],
      metadata: metadata as unknown as Record<string, string>,
    });

    console.info('[events/checkout] PaymentIntent created — id:', paymentIntent.id, '— event:', eventRow.id, '— amount:', paymentIntent.amount);

    await supabase.from('payment_funnel_logs').insert({
      tenant_id:    tenant.id,
      module:       'event',
      event_type:   'intent_created',
      reference_id: eventRow.id,
      detail:       { amount: total },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('[events/checkout] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
