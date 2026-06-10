import { getTenant } from '@/lib/tenant/getTenant';
import OrderConfirmationClient from './OrderConfirmationClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { payment_intent?: string };
}

export default async function OrderConfirmationPage({ searchParams }: PageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  return (
    <OrderConfirmationClient
      paymentIntentId={searchParams.payment_intent ?? null}
      tenant={{
        id:                   tenant.id,
        currency:             tenant.currency,
        click_collect_address: tenant.click_collect_address ?? null,
      }}
    />
  );
}
