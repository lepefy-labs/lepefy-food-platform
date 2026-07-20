import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import OrderConfirmationClient from './OrderConfirmationClient';
import type { Order, OrderItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { payment_intent?: string; order_id?: string };
}

export default async function OrderConfirmationPage({ searchParams }: PageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const tenantProps = {
    id:                   tenant.id,
    currency:             tenant.currency,
    click_collect_address: tenant.click_collect_address ?? null,
  };

  // ── In-store flow: order exists immediately, fetch server-side ──────────────
  if (searchParams.order_id) {
    const supabase = createServiceClient();

    const { data: order } = await supabase
      .from('orders')
      .select(
        'id, email, fulfillment_type, payment_method, payment_status, shipping_address, shipping_cost, subtotal, total',
      )
      .eq('id', searchParams.order_id)
      .eq('tenant_id', tenant.id)
      .maybeSingle() as unknown as { data: Order | null };

    let orderItems: OrderItem[] = [];
    if (order) {
      const { data: items } = await (supabase as unknown as {
        from(t: 'order_items'): ReturnType<ReturnType<typeof createServiceClient>['from']>;
      }).from('order_items').select('id, name, quantity, subtotal').eq('order_id', order.id) as unknown as { data: OrderItem[] | null };
      orderItems = items ?? [];
    }

    return (
      <OrderConfirmationClient
        tenant={tenantProps}
        preloadedOrder={order ? { ...order, order_items: orderItems } : null}
        isInStore
      />
    );
  }

  // ── Stripe flow: polling on payment_intent ──────────────────────────────────
  return (
    <OrderConfirmationClient
      paymentIntentId={searchParams.payment_intent ?? null}
      tenant={tenantProps}
    />
  );
}
