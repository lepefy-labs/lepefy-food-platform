import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { generateTrackingToken } from '@/lib/tracking/generateTrackingToken';
import { OrdersLoginPrompt } from './OrdersLoginPrompt';
import { OrdersEmptyState } from './OrdersEmptyState';
import { OrdersListClient, type OrderListItem } from './OrdersListClient';

// Lit la session (cookies) et interroge Supabase à chaque requête — jamais
// statique, comme les autres pages qui dépendent de getSessionCustomer().
export const dynamic = 'force-dynamic';

interface OrderRow {
  id:         string;
  status:     string;
  created_at: string;
  total:      number;
  email:      string;
}

export default async function OrdersListPage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const sessionCustomer = await getSessionCustomer(tenant.id);

  if (!sessionCustomer) {
    return <OrdersLoginPrompt />;
  }

  const supabase = createServiceClient();

  const { data: orders } = await supabase
    .from('orders')
    .select('id, status, created_at, total, email')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', sessionCustomer.id)
    .order('created_at', { ascending: false }) as { data: OrderRow[] | null };

  if (!orders || orders.length === 0) {
    return <OrdersEmptyState />;
  }

  const orderIds = orders.map((o) => o.id);
  const { data: rawItems } = await (supabase as unknown as {
    from(t: 'order_items'): {
      select(cols: string): {
        in(col: string, vals: string[]): Promise<{ data: { order_id: string }[] | null }>;
      };
    };
  }).from('order_items').select('order_id').in('order_id', orderIds);

  const itemCounts = new Map<string, number>();
  for (const row of rawItems ?? []) {
    itemCounts.set(row.order_id, (itemCounts.get(row.order_id) ?? 0) + 1);
  }

  const ordersWithTokens: OrderListItem[] = orders.map((o) => ({
    id:            o.id,
    status:        o.status,
    created_at:    o.created_at,
    total:         o.total,
    itemCount:     itemCounts.get(o.id) ?? 0,
    trackingToken: generateTrackingToken(o.id, o.email),
  }));

  return <OrdersListClient orders={ordersWithTokens} />;
}
