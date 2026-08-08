import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Poll public — le payment_intent Stripe (pi_...) n'est pas devinable et sert
// de preuve d'achat, comme pour /order-confirmation. Passe par une route
// serveur (service_role) plutôt qu'une lecture directe browser+RLS : les
// tables event_reservations n'ont volontairement aucune policy publique
// (données de contact client, cf. migration 052).
export async function GET(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const paymentIntentId = req.nextUrl.searchParams.get('payment_intent');
  if (!paymentIntentId) {
    return NextResponse.json({ error: 'payment_intent requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: reservation } = await supabase
    .from('event_reservations')
    .select('id, event_id, customer_name, customer_email, amount_paid, qr_token, quantity_total, status')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!reservation) {
    return NextResponse.json({ found: false });
  }

  const { data: event } = await supabase
    .from('events')
    .select('title, slug, date_start, location')
    .eq('id', reservation.event_id)
    .maybeSingle();

  return NextResponse.json({ found: true, reservation, event });
}
