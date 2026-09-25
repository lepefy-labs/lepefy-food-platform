import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';

export const dynamic = 'force-dynamic';

interface SessionRow {
  id: string;
  items: { price: number; quantity: number }[];
  shipping_total: number;
  ambassador_discount_amount: number | null;
}

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * Achat en cours du client connecté, pour le bandeau "Vous avez un achat à
 * terminer" (ActiveCheckoutRecovery). Appelé côté client uniquement : le
 * layout boutique ne lit plus la session pour rester statique/ISR.
 */
export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const customer = await getSessionCustomer(tenant.id);
  if (!customer) return NextResponse.json({ session: null }, { headers: NO_STORE });

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

  if (!data) return NextResponse.json({ session: null }, { headers: NO_STORE });

  const itemCount = data.items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal + (data.shipping_total ?? 0) - (data.ambassador_discount_amount ?? 0);

  return NextResponse.json(
    { session: { id: data.id, itemCount, total } },
    { headers: NO_STORE },
  );
}
