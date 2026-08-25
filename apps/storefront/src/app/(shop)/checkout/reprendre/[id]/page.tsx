import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { checkoutExpiryFromNow } from '@/lib/checkout/activeCheckoutSession';
import { isValidCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import { CheckoutRecoveryClient } from './CheckoutRecoveryClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface RecoverySession {
  id: string;
  customer_id: string | null;
  email: string;
  status: 'open' | 'awaiting_verification' | 'completed' | 'cancelled' | 'expired';
  payment_method: 'stripe' | 'external_link';
  expires_at: string;
  resume_count: number;
}

export default async function CheckoutRecoveryPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { token?: string };
}) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const customer = await getSessionCustomer(tenant.id);
  const supabase = createServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const accessToken = searchParams?.token?.trim() || null;

  const { data: rawSession } = await supabase
    .from('checkout_sessions')
    .select('id, customer_id, email, status, payment_method, expires_at, resume_count')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  const session = rawSession as RecoverySession | null;
  if (!session) notFound();

  const validToken = Boolean(
    accessToken && isValidCheckoutSessionAccessToken(session.id, session.email, accessToken),
  );
  const validCustomer = Boolean(customer && session.customer_id && customer.id === session.customer_id);

  if (!validCustomer && !validToken) notFound();

  const awaitingVerification = session.status === 'awaiting_verification'
    && session.payment_method === 'external_link';
  const openAndRecoverable = session.status === 'open'
    && new Date(session.expires_at).getTime() > now.getTime();

  if (!awaitingVerification && !openAndRecoverable) {
    if (session.status === 'open') {
      await supabase
        .from('checkout_sessions')
        .update({ status: 'expired', updated_at: nowIso })
        .eq('id', session.id)
        .eq('tenant_id', tenant.id)
        .eq('status', 'open')
        .lte('expires_at', nowIso);
    }
    notFound();
  }

  const resumeUpdate: Record<string, unknown> = {
    resume_count: (session.resume_count ?? 0) + 1,
    last_resumed_at: nowIso,
    last_activity_at: nowIso,
    updated_at: nowIso,
  };
  if (session.status === 'open') resumeUpdate.expires_at = checkoutExpiryFromNow(now);

  const { error: resumeError } = await supabase
    .from('checkout_sessions')
    .update(resumeUpdate)
    .eq('id', session.id)
    .eq('tenant_id', tenant.id)
    .in('status', ['open', 'awaiting_verification']);

  if (!resumeError) {
    await supabase.from('payment_funnel_logs').insert({
      tenant_id: tenant.id,
      module: 'shop',
      reference_id: session.id,
      event_type: 'checkout_resumed',
      detail: { source: validToken ? 'payment_reminder_link' : 'customer_account' },
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
      accessToken={validToken ? accessToken ?? undefined : undefined}
      awaitingVerification={awaitingVerification}
    />
  );
}
