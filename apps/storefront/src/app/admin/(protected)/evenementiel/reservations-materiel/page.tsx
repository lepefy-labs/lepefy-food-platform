import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import RentalReservationsClient from './RentalReservationsClient';
import type { RentalReservationRequest } from '@lepefy/types';

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

  // Paiements en attente (Phase 3 — lien externe), tous services confondus.
  const { data: pendingRequestsRaw } = await supabase
    .from('rental_reservation_requests')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const pendingRequests = (pendingRequestsRaw ?? []) as RentalReservationRequest[];

  // Résolution des noms d'articles pour le résumé du bandeau — items ne
  // porte que rental_item_id, jamais le nom (voir migration 061).
  const pendingItemIds = [...new Set(pendingRequests.flatMap((r) => r.items.map((i) => i.rental_item_id)))];
  const { data: pendingRentalItems } = pendingItemIds.length > 0
    ? await supabase.from('rental_items').select('id, name').in('id', pendingItemIds)
    : { data: [] };
  const rentalItemNameById = new Map(
    ((pendingRentalItems ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Réservations matériel</h1>
      <p className="text-sm text-gray-500 mb-6">
        Réservations payées depuis les pages de service en mode « réservation » (Location matériel).
      </p>

      <RentalReservationsClient
        initialReservations={result}
        initialPendingRequests={pendingRequests}
        rentalItemNameById={Object.fromEntries(rentalItemNameById)}
        currency={tenant.currency}
      />
    </div>
  );
}
