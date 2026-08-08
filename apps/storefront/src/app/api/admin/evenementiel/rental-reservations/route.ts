import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function GET() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data: reservations, error } = await supabase
    .from('rental_reservations')
    .select('*, service_offerings(title, slug)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
  }));

  return NextResponse.json(result);
}
