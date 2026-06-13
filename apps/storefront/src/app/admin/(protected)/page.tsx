import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminOrdersClient from '../AdminOrdersClient';
import type { Order } from '@lepefy/types';

export const dynamic = 'force-dynamic';

interface OrderItemRow {
  id:           string;
  name:         string;
  quantity:     number;
  subtotal:     number;
  storage_type: string | null;
}

interface OrderRow extends Order {
  order_items: OrderItemRow[];
}

export default async function AdminPage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const supabase   = createServiceClient();

  // Explicit column list on order_items avoids PostgREST schema-cache failures
  // after an ALTER TABLE (e.g. migration 010). Using '*' on the parent is fine.
  const { data: orders } = await supabase
    .from('orders')
    .select('*, order_items(id, name, quantity, subtotal, storage_type)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(500) as { data: OrderRow[] | null };

  return (
    <AdminOrdersClient
      orders={orders ?? []}
      currency={tenant.currency}
    />
  );
}
