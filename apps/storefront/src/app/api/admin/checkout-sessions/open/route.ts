import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const nowIso = new Date().toISOString();
  const supabase = createServiceClient();

  await supabase
    .from('checkout_sessions')
    .update({ status: 'expired', updated_at: nowIso })
    .eq('tenant_id', tenant.id)
    .eq('status', 'open')
    .lte('expires_at', nowIso);

  const { data, error } = await supabase
    .from('checkout_sessions')
    .select('id, email, full_name, items, shipping_total, ambassador_discount_amount, external_payment_type, external_payment_label, created_at')
    .eq('tenant_id', tenant.id)
    .eq('status', 'open')
    .gt('expires_at', nowIso)
    .eq('payment_method', 'external_link')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[admin/checkout-sessions/open] query failed:', error);
    return NextResponse.json({ error: 'Impossible de charger les paiements en attente.' }, { status: 500 });
  }

  return NextResponse.json({ sessions: data ?? [] });
}
