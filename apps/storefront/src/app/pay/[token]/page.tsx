import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { buildPublicPreorderView, loadSessionByPayToken } from '@/lib/orders/assisted/payLinkPublic';
import PayPreorderClient from './PayPreorderClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const metadata: Metadata = {
  title: 'Paiement de votre précommande',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function PayPreorderPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { paid?: string; redirect_status?: string };
}) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();
  const session = await loadSessionByPayToken(supabase, tenant.id, params.token).catch(() => null);
  const view = session
    ? await buildPublicPreorderView(supabase, tenant, session, await getTenantPaymentMethods(tenant.id))
    : null;

  return (
    <PayPreorderClient
      token={params.token}
      initialView={view}
      returnedFromPayment={searchParams.paid === '1' && searchParams.redirect_status !== 'failed'}
      tenant={{
        name: tenant.name,
        logoUrl: tenant.logo_url,
        primaryColor: tenant.primary_color ?? '#1D9E75',
        whatsappNumber: tenant.whatsapp_number,
        currency: tenant.currency ?? 'EUR',
      }}
    />
  );
}
