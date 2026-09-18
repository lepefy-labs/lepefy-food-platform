import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { generateTrackingToken } from '@/lib/tracking/generateTrackingToken';
import { canUseReviews } from '@/lib/entitlements/tenantEntitlements';
import { OrdersLoginPrompt } from './OrdersLoginPrompt';
import { OrdersEmptyState } from './OrdersEmptyState';
import { OrdersListClient, type OrderListItem } from './OrdersListClient';
import { PendingCheckoutSessionsList, type PendingSessionListItem } from './PendingCheckoutSessionsList';
import { ReviewableOrders, type ReviewableOrderItem } from './ReviewableOrders';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface OrderRow {
  id: string;
  status: string;
  payment_status: string;
  created_at: string;
  total: number;
  email: string;
  fulfillment_type: 'delivery' | 'pickup';
  tracking_code: string | null;
  tracking_carrier: string | null;
}

interface PendingSessionRow {
  id: string;
  full_name: string | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_total: number;
  ambassador_discount_amount: number | null;
  payment_method: 'stripe' | 'external_link';
  external_payment_label: string | null;
  items: { price: number; quantity: number }[];
  created_at: string;
}

export default async function OrdersListPage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const sessionCustomer = await getSessionCustomer(tenant.id);
  if (!sessionCustomer) return <OrdersLoginPrompt />;

  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();
  const customerId = sessionCustomer.id;

  // orders is independent of checkout_sessions state, so it runs alongside
  // the expire-then-read pair instead of after both.
  async function expireAndLoadPendingSessions() {
    await supabase.from('checkout_sessions').update({ status: 'expired', updated_at: nowIso })
      .eq('tenant_id', tenant.id).eq('customer_id', customerId).eq('status', 'open').lte('expires_at', nowIso);
    return supabase.from('checkout_sessions')
      .select('id, full_name, fulfillment_type, shipping_total, ambassador_discount_amount, payment_method, external_payment_label, items, created_at')
      .eq('tenant_id', tenant.id).eq('customer_id', customerId).eq('status', 'open').gt('expires_at', nowIso)
      .order('last_activity_at', { ascending: false }).limit(1) as unknown as Promise<{ data: PendingSessionRow[] | null }>;
  }

  const [{ data: orders }, { data: pendingSessions }] = await Promise.all([
    supabase.from('orders')
      .select('id, status, payment_status, created_at, total, email, fulfillment_type, tracking_code, tracking_carrier')
      .eq('tenant_id', tenant.id).eq('customer_id', customerId).order('created_at', { ascending: false }) as unknown as Promise<{ data: OrderRow[] | null }>,
    expireAndLoadPendingSessions(),
  ]);

  const pendingItems: PendingSessionListItem[] = (pendingSessions ?? []).map((s) => {
    const itemCount = s.items.reduce((sum, i) => sum + i.quantity, 0);
    const subtotal = s.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const total = subtotal + (s.shipping_total ?? 0) - (s.ambassador_discount_amount ?? 0);
    return { id: s.id, createdAt: s.created_at, itemCount, total, fulfillmentType: s.fulfillment_type, paymentMethod: s.payment_method, externalPaymentLabel: s.external_payment_label };
  });

  if ((!orders || orders.length === 0) && pendingItems.length === 0) return <OrdersEmptyState />;

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: rawItems } = orderIds.length === 0 ? { data: [] } : await (supabase as unknown as {
    from(t: 'order_items'): { select(cols: string): { in(col: string, vals: string[]): Promise<{ data: { order_id: string; quantity: number }[] | null }> } };
  }).from('order_items').select('order_id, quantity').in('order_id', orderIds);

  const itemCounts = new Map<string, number>();
  for (const row of rawItems ?? []) itemCounts.set(row.order_id, (itemCounts.get(row.order_id) ?? 0) + row.quantity);

  const ordersWithTokens: OrderListItem[] = (orders ?? []).map((o) => ({
    id: o.id, status: o.status, created_at: o.created_at, total: o.total, itemCount: itemCounts.get(o.id) ?? 0,
    fulfillmentType: o.fulfillment_type, hasTracking: Boolean(o.tracking_code), trackingCarrier: o.tracking_carrier,
    trackingToken: generateTrackingToken(o.id, o.email),
  }));

  let reviewableOrders: ReviewableOrderItem[] = [];
  if (await canUseReviews(tenant.id)) {
    const eligible = (orders ?? []).filter((order) => order.status === 'delivered' && order.payment_status === 'paid');
    if (eligible.length > 0) {
      const eligibleIds = eligible.map((order) => order.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingReviews } = await (supabase as any).from('reviews').select('order_id').eq('tenant_id', tenant.id).in('order_id', eligibleIds).eq('review_type', 'service');
      const reviewed = new Set((existingReviews ?? []).map((review: { order_id: string }) => review.order_id));
      reviewableOrders = eligible.filter((order) => !reviewed.has(order.id)).map((order) => ({ id: order.id, createdAt: order.created_at }));
    }
  }

  return (
    <>
      {pendingItems.length > 0 && <PendingCheckoutSessionsList sessions={pendingItems} />}
      <ReviewableOrders orders={reviewableOrders} />
      {ordersWithTokens.length > 0 && <OrdersListClient orders={ordersWithTokens} />}
    </>
  );
}
