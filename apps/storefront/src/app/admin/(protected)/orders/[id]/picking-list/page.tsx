import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import PickingList from '../../../../orders/[id]/PickingList';
import AutoPrint from '../../AutoPrint';
import type { Order, OrderItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  params: { id: string };
}

export default async function PickingListPage({ params }: PageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const supabase   = createServiceClient();

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle() as { data: Order | null };

  if (!order) notFound();

  // Fetch all items for this order. We sort by warehouse_location in JS so
  // the query works even before migration 010 is applied in production.
  const { data: rawItems } = await (supabase as unknown as {
    from(t: 'order_items'): ReturnType<ReturnType<typeof createServiceClient>['from']>;
  }).from('order_items')
    .select('*')
    .eq('order_id', order.id) as { data: OrderItem[] | null };

  // Sort by warehouse_location (nulls last) — safe whether column exists or not.
  const items = (rawItems ?? []).sort((a, b) => {
    const la = a.warehouse_location ?? '';
    const lb = b.warehouse_location ?? '';
    if (!la && !lb) return 0;
    if (!la) return 1;
    if (!lb) return -1;
    return la.localeCompare(lb);
  });

  return (
    <>
      <AutoPrint />
      <PickingList order={order} items={items} currency={tenant.currency} />
    </>
  );
}
