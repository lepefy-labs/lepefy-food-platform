import { createServiceClient } from '@/lib/supabase/server';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import type { Tenant } from '@lepefy/types';
import { ActiveCheckoutRecoveryBar } from './ActiveCheckoutRecoveryBar';

interface SessionRow {
  id: string;
  items: { price: number; quantity: number }[];
  shipping_total: number;
  ambassador_discount_amount: number | null;
}

export async function ActiveCheckoutRecovery({ tenant }: { tenant: Tenant }) {
  const customer = await getSessionCustomer(tenant.id);
  if (!customer) return null;

  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  // Lazy expiration keeps stale purchase intents out of every customer-facing
  // surface even without a cron extension installed in Supabase.
  await supabase
    .from('checkout_sessions')
    .update({ status: 'expired', updated_at: nowIso })
    .eq('tenant_id', tenant.id)
    .eq('customer_id', customer.id)
    .eq('status', 'open')
    .lte('expires_at', nowIso);

  const { data } = await supabase
    .from('checkout_sessions')
    .select('id, items, shipping_total, ambassador_discount_amount')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', customer.id)
    .eq('status', 'open')
    .gt('expires_at', nowIso)
    .order('last_activity_at', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: SessionRow | null };

  if (!data) return null;

  const itemCount = data.items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal + (data.shipping_total ?? 0) - (data.ambassador_discount_amount ?? 0);

  return (
    <ActiveCheckoutRecoveryBar
      sessionId={data.id}
      itemCount={itemCount}
      total={total}
      currency={tenant.currency ?? 'eur'}
    />
  );
}
