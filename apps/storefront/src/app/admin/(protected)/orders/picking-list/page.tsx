import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import PickingList from '../../../orders/[id]/PickingList';
import AutoPrint from '../AutoPrint';
import type { Order, OrderItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { ids?: string };
}

type OrderWithItems = Order & { order_items: OrderItem[] | null };

export default async function BulkPickingListPage({ searchParams }: PageProps) {
  const ids = (searchParams.ids ?? '').split(',').filter(Boolean);
  if (ids.length === 0) notFound();

  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const supabase   = createServiceClient();

  // Stessa logica di fetch di [id]/page.tsx, ma con .in('id', ids);
  // il tenant scoping resta identico.
  const { data: rawOrders } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .in('id', ids)
    .eq('tenant_id', tenant.id) as { data: OrderWithItems[] | null };

  const orders = rawOrders ?? [];
  if (orders.length === 0) notFound();

  // Sort by warehouse_location (nulls last) — stessa regola della pagina singola.
  function sortItems(items: OrderItem[] | null): OrderItem[] {
    return (items ?? []).slice().sort((a, b) => {
      const la = a.warehouse_location ?? '';
      const lb = b.warehouse_location ?? '';
      if (!la && !lb) return 0;
      if (!la) return 1;
      if (!lb) return -1;
      return la.localeCompare(lb);
    });
  }

  return (
    <>
      <AutoPrint />
      {orders.map((order, idx) => (
        <div key={order.id} style={idx > 0 ? { pageBreakBefore: 'always' } : undefined}>
          <PickingList
            order={order}
            items={sortItems(order.order_items)}
            currency={tenant.currency}
          />
        </div>
      ))}
    </>
  );
}
