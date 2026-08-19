import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { generateTrackingToken } from '@/lib/tracking/generateTrackingToken';
import { OrdersLoginPrompt } from './OrdersLoginPrompt';
import { OrdersEmptyState } from './OrdersEmptyState';
import { OrdersListClient, type OrderListItem } from './OrdersListClient';
import { PendingCheckoutSessionsList, type PendingSessionListItem } from './PendingCheckoutSessionsList';

// Lit la session (cookies) et interroge Supabase à chaque requête — jamais
// statique, comme les autres pages qui dépendent de getSessionCustomer().
// checkout_sessions est mutable (status peut passer à 'cancelled' à tout
// moment depuis un autre onglet/appareil) — même règle que les Route
// Handlers GET touchés par ce chantier (bug Next.js 14.2.x, force-dynamic
// seul ne suffit pas).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface OrderRow {
  id:         string;
  status:     string;
  created_at: string;
  total:      number;
  email:      string;
}

interface PendingSessionRow {
  id:                         string;
  full_name:                  string | null;
  fulfillment_type:           'delivery' | 'pickup';
  shipping_total:             number;
  ambassador_discount_amount: number | null;
  payment_method:             'stripe' | 'external_link';
  external_payment_label:     string | null;
  items:                      { price: number; quantity: number }[];
  created_at:                 string;
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

  // Requêtes indépendantes des orders confirmés — une checkout_session
  // pending est une entité à part (cf. contexte du prompt : jamais fusionnée
  // ni masquée par la présence/absence de commandes confirmées).
  const { data: pendingSessions } = await supabase
    .from('checkout_sessions')
    .select('id, full_name, fulfillment_type, shipping_total, ambassador_discount_amount, payment_method, external_payment_label, items, created_at')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', sessionCustomer.id)
    .eq('status', 'open')
    .order('created_at', { ascending: false }) as { data: PendingSessionRow[] | null };

  const pendingItems: PendingSessionListItem[] = (pendingSessions ?? []).map((s) => {
    const itemCount = s.items.reduce((sum, i) => sum + i.quantity, 0);
    const subtotal  = s.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const total     = subtotal + (s.shipping_total ?? 0) - (s.ambassador_discount_amount ?? 0);
    return {
      id:                s.id,
      createdAt:         s.created_at,
      itemCount,
      total,
      fulfillmentType:   s.fulfillment_type,
      paymentMethod:     s.payment_method,
      externalPaymentLabel: s.external_payment_label,
    };
  });

  if ((!orders || orders.length === 0) && pendingItems.length === 0) {
    return <OrdersEmptyState />;
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: rawItems } = orderIds.length === 0 ? { data: [] } : await (supabase as unknown as {
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

  const ordersWithTokens: OrderListItem[] = (orders ?? []).map((o) => ({
    id:            o.id,
    status:        o.status,
    created_at:    o.created_at,
    total:         o.total,
    itemCount:     itemCounts.get(o.id) ?? 0,
    trackingToken: generateTrackingToken(o.id, o.email),
  }));

  return (
    <>
      {pendingItems.length > 0 && <PendingCheckoutSessionsList sessions={pendingItems} />}
      {ordersWithTokens.length > 0 && <OrdersListClient orders={ordersWithTokens} />}
    </>
  );
}
