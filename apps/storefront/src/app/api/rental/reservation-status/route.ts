import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export async function GET(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const paymentIntentId = req.nextUrl.searchParams.get('payment_intent');
  if (!paymentIntentId) {
    return NextResponse.json({ error: 'payment_intent requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: reservation } = await supabase
    .from('rental_reservations')
    .select('id, service_offering_id, customer_name, customer_email, pickup_date, amount_paid, status')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!reservation) {
    return NextResponse.json({ found: false });
  }

  const { data: offering } = await supabase
    .from('service_offerings')
    .select('title, slug')
    .eq('id', reservation.service_offering_id)
    .maybeSingle();

  const { data: items } = await supabase
    .from('rental_reservation_items')
    .select('quantity, unit_price, rental_items(name)')
    .eq('reservation_id', reservation.id);

  return NextResponse.json({ found: true, reservation, offering, items: items ?? [] });
}
