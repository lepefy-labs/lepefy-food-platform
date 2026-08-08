import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import RentalReservationsClient from './RentalReservationsClient';

export const dynamic = 'force-dynamic';

interface RentalReservationWithDetails {
  id: string;
  customer_name: string;
  customer_email: string;
  pickup_date: string;
  amount_paid: number;
  status: 'confirmed' | 'cancelled' | 'refunded';
  created_at: string;
  service_offerings: { title: string; slug: string } | null;
  items: { quantity: number; unit_price: number; rental_items: { name: string } | null }[];
}

export default async function AdminRentalReservationsPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();

  const { data: reservations } = await supabase
    .from('rental_reservations')
    .select('*, service_offerings(title, slug)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  const ids = (reservations ?? []).map((r) => r.id as string);
  const { data: items } = ids.length > 0
    ? await supabase
        .from('rental_reservation_items')
        .select('*, rental_items(name)')
        .in('reservation_id', ids)
    : { data: [] };

  const itemsByReservation = new Map<string, unknown[]>();
  for (const item of (items ?? []) as { reservation_id: string }[]) {
    const list = itemsByReservation.get(item.reservation_id) ?? [];
    list.push(item);
    itemsByReservation.set(item.reservation_id, list);
  }

  const result = (reservations ?? []).map((r) => ({
    ...r,
    items: itemsByReservation.get(r.id as string) ?? [],
  })) as unknown as RentalReservationWithDetails[];

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Réservations matériel</h1>
      <p className="text-sm text-gray-500 mb-6">
        Réservations payées depuis les pages de service en mode « réservation » (Location matériel).
      </p>

      <RentalReservationsClient initialReservations={result} currency={tenant.currency} />
    </div>
  );
}
