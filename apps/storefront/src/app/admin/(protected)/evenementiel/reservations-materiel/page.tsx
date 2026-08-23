import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import RentalReservationsClient from './RentalReservationsClient';
import type { RentalReservationRequest } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

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
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: reservations } = await supabase
    .from('rental_reservations')
    .select('*, service_offerings(title, slug)')
    .eq('tenant_id', tenant.id)
    .order('pickup_date', { ascending: true });

  const ids = (reservations ?? []).map((r) => r.id as string);
  const { data: items } = ids.length > 0
    ? await supabase.from('rental_reservation_items').select('*, rental_items(name)').in('reservation_id', ids)
    : { data: [] };

  const itemsByReservation = new Map<string, unknown[]>();
  for (const item of (items ?? []) as { reservation_id: string }[]) {
    const list = itemsByReservation.get(item.reservation_id) ?? [];
    list.push(item);
    itemsByReservation.set(item.reservation_id, list);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result = (reservations ?? []).map((r) => ({
    ...r,
    items: itemsByReservation.get(r.id as string) ?? [],
  })).sort((a, b) => {
    const aUpcoming = a.status === 'confirmed' && new Date(a.pickup_date).getTime() >= today.getTime();
    const bUpcoming = b.status === 'confirmed' && new Date(b.pickup_date).getTime() >= today.getTime();
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    const aTime = new Date(a.pickup_date).getTime();
    const bTime = new Date(b.pickup_date).getTime();
    return aUpcoming ? aTime - bTime : bTime - aTime;
  }) as unknown as RentalReservationWithDetails[];

  const { data: pendingRequestsRaw } = await supabase
    .from('rental_reservation_requests')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const pendingRequests = (pendingRequestsRaw ?? []) as RentalReservationRequest[];
  const pendingItemIds = [...new Set(pendingRequests.flatMap((r) => r.items.map((i) => i.rental_item_id)))];
  const { data: pendingRentalItems } = pendingItemIds.length > 0
    ? await supabase.from('rental_items').select('id, name').in('id', pendingItemIds)
    : { data: [] };
  const rentalItemNameById = new Map(((pendingRentalItems ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-950 dark:text-white">Locations</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500 dark:text-gray-400">
        Retraits confirmés à venir en priorité, puis historique des réservations.
      </p>
      <RentalReservationsClient initialReservations={result} initialPendingRequests={pendingRequests} rentalItemNameById={Object.fromEntries(rentalItemNameById)} currency={tenant.currency} />
    </div>
  );
}
