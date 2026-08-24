import { redirect, notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { checkoutExpiryFromNow } from '@/lib/checkout/activeCheckoutSession';
import { CheckoutRecoveryClient } from './CheckoutRecoveryClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function CheckoutRecoveryPage({ params }: { params: { id: string } }) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const customer = await getSessionCustomer(tenant.id);
  if (!customer) redirect('/compte/connexion');

  const supabase = createServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: session } = await supabase
    .from('checkout_sessions')
    .select('id, customer_id, status, expires_at, resume_count')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle() as {
      data: { id: string; customer_id: string | null; status: string; expires_at: string; resume_count: number } | null;
    };

  if (!session || session.customer_id !== customer.id) notFound();

  if (session.status !== 'open' || new Date(session.expires_at).getTime() <= now.getTime()) {
    if (session.status === 'open') {
      await supabase
        .from('checkout_sessions')
        .update({ status: 'expired', updated_at: nowIso })
        .eq('id', session.id)
        .eq('tenant_id', tenant.id);
    }
    notFound();
  }

  const { error: resumeError } = await supabase
    .from('checkout_sessions')
    .update({
      resume_count: (session.resume_count ?? 0) + 1,
      last_resumed_at: nowIso,
      last_activity_at: nowIso,
      updated_at: nowIso,
      expires_at: checkoutExpiryFromNow(now),
    })
    .eq('id', session.id)
    .eq('tenant_id', tenant.id);

  if (!resumeError) {
    await supabase.from('payment_funnel_logs').insert({
      tenant_id: tenant.id,
      module: 'shop',
      reference_id: session.id,
      event_type: 'checkout_resumed',
    });
  }

  const allMethods = await getTenantPaymentMethods(tenant.id);
  const externalPaymentMethods = allMethods.filter(
    (m) => m.method !== 'bank_transfer' && m.method !== 'cash' && !!m.extra?.link
      && m.enabled_modules.includes('shop'),
  );

  return (
    <CheckoutRecoveryClient
      tenant={tenant}
      externalPaymentMethods={externalPaymentMethods}
      sessionId={session.id}
    />
  );
}
